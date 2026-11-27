import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { test } from '@japa/runner'
import { bootFixture } from './helpers.ts'

async function changelogUpgrade(heading: string) {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  return changelog.split(`### ${heading}`)[1]?.match(/```ts\n([\s\S]*?)\n```/)?.[1]
}

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

    const source = await changelogUpgrade('Upgrade the confirmations table from 0.1.1')
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
    const request = {
      operation: 'transfer-ownership',
      scope: 'company-1',
      intent: { toUserId: 'u2' },
    }
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
}).timeout(30_000)

test('the documented upgrade renames action to operation after the 0.6.0 create migration ran', async ({
  assert,
}) => {
  const fixture = await bootFixture({
    async prepareMigrations(root) {
      const directory = join(root, 'database/migrations')
      const migrations = await readdir(directory)
      const path = join(
        directory,
        migrations.find((file) => file.endsWith('_create_password_confirmations_table.ts'))!
      )
      const current = await readFile(path, 'utf8')
      // Recreate the 0.6.0 stub's column name.
      const original = current.replace(
        "table.string('operation', 255)",
        "table.string('action', 255)"
      )
      assert.notEqual(original, current)
      await writeFile(path, original)
    },
  })
  try {
    const { app, db, root } = fixture
    const hasColumn = (name: string) =>
      db.connection().schema.hasColumn('password_confirmations', name)
    assert.isTrue(await hasColumn('action'))
    assert.isFalse(await hasColumn('operation'))

    const source = await changelogUpgrade('Upgrade the confirmations table from 0.6.0')
    assert.isString(source)
    await writeFile(
      join(root, 'database/migrations/9999999999999_rename_confirmation_action.ts'),
      source!
    )
    const migrator = new MigrationRunner(db, app, { direction: 'up', dryRun: false })
    await migrator.run()
    if (migrator.error) throw migrator.error
    assert.isFalse(await hasColumn('action'))
    assert.isTrue(await hasColumn('operation'))

    const email = 'rename-upgrade@example.test'
    const password = 'Upgrade-test-password-7'
    await fixture.createUser(email, password)
    const input = await fixture.login(email, password)
    const confirmations = fixture.makePasswordConfirmations()
    const request = {
      operation: 'transfer-ownership',
      scope: 'company-1',
      intent: { toUserId: 'u2' },
    }
    const { confirmationId } = await confirmations.confirmPassword(input, { ...request, password })
    assert.equal(
      await confirmations.withConfirmation(
        input,
        { ...request, confirmationId },
        async () => 'ran'
      ),
      'ran'
    )
  } finally {
    await fixture.close()
  }
}).timeout(30_000)
