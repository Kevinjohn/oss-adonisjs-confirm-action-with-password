/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { configuredAppRoot } from './helpers.js'

test.group('configure', () => {
  test('publishes config, one migration and one provider, and is idempotent', async ({
    assert,
  }) => {
    const { root, ignitor } = await configuredAppRoot()
    try {
      const migrations = async () => {
        const files = await readdir(join(root, 'database/migrations'))
        return files.filter((file) => file.endsWith('_create_password_confirmations_table.ts'))
      }
      assert.lengthOf(await migrations(), 1)
      const [migrationFile] = await migrations()
      const migration = await readFile(join(root, 'database/migrations', migrationFile), 'utf8')
      assert.include(migration, `table.integer('user_id').unsigned()`)
      assert.include(migration, `.inTable('account_sessions').onDelete('CASCADE')`)
      assert.include(migration, `protected tableName = 'password_confirmations'`)
      assert.include(migration, `table.index(['user_id'])`)
      assert.include(migration, `table.index(['consumed_at'])`)
      assert.include(
        await readFile(join(root, 'config/password_confirmations.ts'), 'utf8'),
        `window: '5m'`
      )
      const rc = await readFile(join(root, 'adonisrc.ts'), 'utf8')
      assert.lengthOf(
        rc.match(/adonisjs-confirm-action-with-password\/password_confirmations_provider/g) ?? [],
        1
      )

      await ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-confirm-action-with-password'])
      assert.lengthOf(await migrations(), 1)
      assert.equal(await readFile(join(root, 'adonisrc.ts'), 'utf8'), rc)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('--table names the migration table and the config together', async ({ assert }) => {
    const { root, ignitor } = await configuredAppRoot()
    try {
      await rm(join(root, 'database/migrations'), { recursive: true })
      await rm(join(root, 'config/password_confirmations.ts'))
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--table=sensitive_confirmations',
        ])
      const [file] = await readdir(join(root, 'database/migrations'))
      assert.include(
        await readFile(join(root, 'database/migrations', file), 'utf8'),
        `protected tableName = 'sensitive_confirmations'`
      )
      assert.include(
        await readFile(join(root, 'config/password_confirmations.ts'), 'utf8'),
        `table: 'sensitive_confirmations'`
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('warns when the Account Kit sessions migration is not there to sort after', async ({
    assert,
  }) => {
    const { root, ignitor } = await configuredAppRoot()
    const written: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    try {
      await rm(join(root, 'database/migrations'), { recursive: true })
      process.stdout.write = ((chunk: string) => {
        written.push(String(chunk))
        return true
      }) as typeof process.stdout.write
      await ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-confirm-action-with-password'])
    } finally {
      process.stdout.write = write
      await rm(root, { recursive: true, force: true })
    }
    assert.match(written.join(''), /configure @kevinjohn\/adonisjs-account-kit first/)
  }).timeout(30_000)

  test('honours --user-id-type and refuses bad flags', async ({ assert }) => {
    const { root, ignitor } = await configuredAppRoot()
    try {
      await rm(join(root, 'database/migrations'), { recursive: true })
      const ace = ignitor.ace()
      await ace.handle([
        'configure',
        '@kevinjohn/adonisjs-confirm-action-with-password',
        '--user-id-type=uuid',
      ])
      const [file] = await readdir(join(root, 'database/migrations'))
      assert.include(
        await readFile(join(root, 'database/migrations', file), 'utf8'),
        `table.uuid('user_id')`
      )
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--users-table=a-b',
        ])
      assert.equal(process.exitCode, 1)
      process.exitCode = undefined
      // A bad --table is refused too, and writes nothing.
      await rm(join(root, 'database/migrations'), { recursive: true })
      await rm(join(root, 'config/password_confirmations.ts'))
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--table=confirmations; drop',
        ])
      assert.equal(process.exitCode, 1)
      process.exitCode = undefined
      assert.notInclude(await readdir(join(root, 'config')), 'password_confirmations.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)
})
