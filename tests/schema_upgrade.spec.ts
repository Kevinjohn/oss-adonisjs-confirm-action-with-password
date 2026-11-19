import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { test } from '@japa/runner'
import { bootFixture } from './helpers.js'

test('the documented upgrade adds expiry after the 0.1.1 create migration ran', async ({
  assert,
}) => {
  let originalMigration: string
  const fixture = await bootFixture({
    async prepareMigrations(root) {
      const directory = join(root, 'database/migrations')
      const migrations = await readdir(directory)
      originalMigration = migrations.find((file) =>
        file.endsWith('_create_password_confirmations_table.ts')
      )!
      const path = join(directory, originalMigration)
      const current = await readFile(path, 'utf8')
      // Recreate the 0.1.1 stub's column and index definitions.
      await writeFile(
        path,
        current
          .replace(/^.*The deadline returned to the client.*\n/m, '')
          .replace(/^.*table\.bigInteger\('expires_at'\).*\n/m, '')
          .replaceAll('expires_at', 'verified_at')
      )
    },
  })
  try {
    const { app, db, root } = fixture
    assert.isFalse(await db.connection().schema.hasColumn('password_confirmations', 'expires_at'))
    const original = `database/migrations/${originalMigration!.replace(/\.ts$/, '')}`
    await db.from('adonis_schema').where('name', original).firstOrFail()

    const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    const upgrade = changelog.split('### Upgrade the confirmations table from 0.1.1')[1]
    const source = upgrade?.match(/```ts\n([\s\S]*?)\n```/)?.[1]
    assert.isString(source)
    await writeFile(
      join(root, 'database/migrations/9999999999999_add_confirmation_expiry.ts'),
      source!
    )
    const migrator = new MigrationRunner(db, app, { direction: 'up', dryRun: false })
    await migrator.run()
    if (migrator.error) throw migrator.error
    const recorded = await db.from('adonis_schema').where('name', original)
    assert.lengthOf(recorded, 1)

    const email = 'schema-upgrade@example.test'
    const password = 'Upgrade-test-password-7'
    await fixture.createUser(email, password)
    const input = await fixture.login(email, password)
    const confirmations = fixture.makePasswordConfirmations()
    const request = { action: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }
    const { confirmationId, expiresAt } = await confirmations.confirmPassword(input, {
      ...request,
      password,
    })
    assert.equal(
      await confirmations.withConfirmation(
        input,
        { ...request, confirmationId },
        async () => 'ran'
      ),
      'ran'
    )
    fixture.clock.now = expiresAt + 1
    assert.equal(await confirmations.prune(), 1)
    assert.isNull(await db.from('password_confirmations').where('id', confirmationId).first())
  } finally {
    await fixture.close()
  }
})
