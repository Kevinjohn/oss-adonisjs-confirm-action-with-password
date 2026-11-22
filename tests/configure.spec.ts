/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@japa/runner'
import type Configure from '@adonisjs/core/commands/configure'
import { configure } from '../configure.js'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { bootFixture, prepareConfiguredAppRoot } from './helpers.js'

/** Lightweight command for inspection-only failures: no host packages or codemods are needed. */
function inspectionCommand(root: string, database?: unknown) {
  const warnings: string[] = []
  const migrations: string[] = []
  const command = {
    app: {
      config: database === undefined ? undefined : { get: () => database },
      configPath: (name: string) => join(root, 'config', name),
      migrationsPath: () => join(root, 'host/migrations'),
      makePath: () => root,
      import: (specifier: string) => import(specifier),
    },
    parsedFlags: {},
    logger: { warning: (message: string) => warnings.push(message), info: () => {} },
    createCodemods: async () => ({
      makeUsingStub: async (
        _root: string,
        _stub: string,
        data: { migration?: { destination: string } }
      ) => {
        if (data.migration) migrations.push(data.migration.destination)
      },
      updateRcFile: async () => {},
    }),
  } as unknown as Configure
  return { command, warnings, migrations }
}

test.group('configure', () => {
  test('publishes config, one migration and one provider, and is idempotent', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
    try {
      const listMigrationNames = async () => {
        const files = await readdir(join(root, 'database/migrations'))
        return files.filter((file) => file.endsWith('_create_password_confirmations_table.ts'))
      }
      assert.lengthOf(await listMigrationNames(), 1)
      const [migrationFile] = await listMigrationNames()
      const migration = await readFile(join(root, 'database/migrations', migrationFile), 'utf8')
      assert.include(
        migration,
        `table.integer('user_id').unsigned().notNullable().references('id').inTable('users')`
      )
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
      assert.lengthOf(await listMigrationNames(), 1)
      assert.equal(await readFile(join(root, 'adonisrc.ts'), 'utf8'), rc)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('--table and --users-table name the migration tables and the config together', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
    try {
      await rm(join(root, 'database/migrations'), { recursive: true })
      await rm(join(root, 'config/password_confirmations.ts'))
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--table=sensitive_confirmations',
          '--users-table=members',
        ])
      const [file] = await readdir(join(root, 'database/migrations'))
      const migration = await readFile(join(root, 'database/migrations', file), 'utf8')
      assert.include(migration, `protected tableName = 'sensitive_confirmations'`)
      assert.include(migration, `.inTable('members')`)
      const config = await readFile(join(root, 'config/password_confirmations.ts'), 'utf8')
      assert.include(config, `table: 'sensitive_confirmations'`)
      assert.include(config, `usersTable: 'members'`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('warns when the Account Kit sessions migration is not there to sort after', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
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

  test('a rerun with other flags warns about the files it leaves alone and changes nothing', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
    const written: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    const capture = async (flags: string[]) => {
      written.length = 0
      process.stdout.write = ((chunk: string) => {
        written.push(String(chunk))
        return true
      }) as typeof process.stdout.write
      try {
        await ignitor
          .ace()
          .handle(['configure', '@kevinjohn/adonisjs-confirm-action-with-password', ...flags])
      } finally {
        process.stdout.write = write
      }
      return written.join('')
    }
    try {
      const migrations = join(root, 'database/migrations')
      const names = await readdir(migrations)
      const file = names.find((name) => name.endsWith('_create_password_confirmations_table.ts'))!
      const before = [
        await readFile(join(root, 'config/password_confirmations.ts'), 'utf8'),
        await readFile(join(migrations, file), 'utf8'),
      ]
      // The same flags again: nothing to report.
      assert.notMatch(await capture([]), /does not match/)
      const output = await capture(['--table=sensitive_confirmations'])
      assert.match(output, /config\/password_confirmations\.ts already exists and does not match/)
      assert.match(
        output,
        /_create_password_confirmations_table\.ts already exists and does not match/
      )
      assert.match(
        await capture(['--user-id-type=uuid']),
        /--user-id-type uuid; it was left unchanged/
      )
      assert.deepEqual(
        [
          await readFile(join(root, 'config/password_confirmations.ts'), 'utf8'),
          await readFile(join(migrations, file), 'utf8'),
        ],
        before
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('the migration sorts after an Account Kit migration dated ahead of the clock', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
    try {
      const migrations = join(root, 'database/migrations')
      await rm(migrations, { recursive: true })
      await rm(join(root, 'config/password_confirmations.ts'))
      const ahead = Date.now() + 60 * 60_000
      await mkdir(migrations)
      await writeFile(join(migrations, `${ahead}_account_kit_create_account_sessions.ts`), '')
      await ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-confirm-action-with-password'])
      const files = await readdir(migrations)
      const file = files.find((name) => name.endsWith('_create_password_confirmations_table.ts'))!
      assert.isAbove(Number.parseInt(file, 10), ahead)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('uses the primary Lucid connection migration path for ordering and reruns', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
    try {
      const directory = join(root, 'schema/primary')
      await mkdir(directory, { recursive: true })
      const defaultDirectory = join(root, 'database/migrations')
      const ahead = Date.now() + 60 * 60_000
      const defaultNames = await readdir(defaultDirectory)
      const kitMigration = defaultNames.find((file) =>
        file.endsWith('_account_kit_create_account_sessions.ts')
      )!
      await rename(
        join(defaultDirectory, kitMigration),
        join(directory, `${ahead}_account_kit_create_account_sessions.ts`)
      )
      const oldConfirmation = defaultNames.find((file) =>
        file.endsWith('_create_password_confirmations_table.ts')
      )!
      await rm(join(defaultDirectory, oldConfirmation))
      await rm(join(root, 'config/password_confirmations.ts'))
      await writeFile(
        join(root, 'config/database.ts'),
        `export default { connection: 'primary', connections: { primary: { migrations: { paths: ['schema/primary'] } }, other: { migrations: { paths: ['other'] } } } }`
      )
      const run = () =>
        ignitor.ace().handle(['configure', '@kevinjohn/adonisjs-confirm-action-with-password'])
      await run()
      const names = await readdir(directory)
      const file = names.find((name) => name.endsWith('_create_password_confirmations_table.ts'))!
      assert.isAbove(Number.parseInt(file, 10), ahead)
      assert.notInclude(await readdir(defaultDirectory), oldConfirmation)
      const edited = (await readFile(join(directory, file), 'utf8')) + '\n// Host edit\n'
      await writeFile(join(directory, file), edited)
      await run()
      assert.deepEqual(await readdir(directory), names)
      assert.equal(await readFile(join(directory, file), 'utf8'), edited)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('ignores symlinks, publishes after a nested sessions migration and preserves the new identity', async ({
    assert,
  }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot(true)
    try {
      const directory = join(root, 'database/migrations')
      const names = await readdir(directory)
      const sessions = names.find((file) =>
        file.endsWith('_account_kit_create_account_sessions.ts')
      )!
      const confirmation = names.find((file) =>
        file.endsWith('_create_password_confirmations_table.ts')
      )!
      const prior = join(directory, 'prior')
      await mkdir(prior)
      await rename(join(directory, sessions), join(prior, sessions))
      await rename(join(directory, confirmation), join(root, 'outside.ts'))
      await symlink(
        join(root, 'outside.ts'),
        join(directory, '1_create_password_confirmations_table.ts')
      )
      await symlink(
        join(root, 'absent.ts'),
        join(directory, '2_create_password_confirmations_table.ts')
      )
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--user-id-type=string',
        ])

      const fixture = await bootFixture({ sharedRoot: root, hostProfile: true })
      try {
        const runner = new MigrationRunner(fixture.db, fixture.app, {
          direction: 'up',
          dryRun: false,
        })
        const before = await runner.getList()
        const confirmations = before.filter(({ name }) =>
          name.endsWith('_create_password_confirmations_table')
        )
        assert.lengthOf(confirmations, 1)
        const parent = before.findIndex(({ name }) =>
          name.endsWith('_account_kit_create_account_sessions')
        )
        assert.isAtLeast(parent, 0)
        assert.isAbove(before.indexOf(confirmations[0]), parent)
        assert.match(confirmations[0].name, /^database\/migrations\/prior\//)
        assert.equal(confirmations[0].status, 'migrated')
        assert.isTrue(await fixture.db.connection().schema.hasTable('password_confirmations'))
        assert.deepEqual(await fixture.db.rawQuery('PRAGMA foreign_keys'), [{ foreign_keys: 1 }])
        await ignitor
          .ace()
          .handle([
            'configure',
            '@kevinjohn/adonisjs-confirm-action-with-password',
            '--user-id-type=string',
          ])
        assert.deepEqual(await runner.getList(), before)
      } finally {
        await fixture.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }).timeout(30_000)

  test('refuses ambiguous migration directories before generating files', async ({ assert }) => {
    const root = await mkdtemp(join(tmpdir(), 'confirm-inspect-'))
    try {
      const { command, migrations } = inspectionCommand(root, {
        connection: 'primary',
        connections: { primary: { migrations: { paths: ['one', 'two'] } } },
      })
      await assert.rejects(() => configure(command), /multiple migration paths/)
      assert.lengthOf(migrations, 0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports non-missing inspection failures with the file path', async ({ assert }) => {
    const root = await mkdtemp(join(tmpdir(), 'confirm-inspect-'))
    try {
      const config = join(root, 'config/password_confirmations.ts')
      await mkdir(config, { recursive: true })
      const { command, migrations } = inspectionCommand(root)
      await assert.rejects(
        () => configure(command),
        `password_confirmations: cannot inspect ${config}`
      )
      assert.lengthOf(migrations, 0)
      await rm(config, { recursive: true })
      await mkdir(join(root, 'host'), { recursive: true })
      const directory = join(root, 'host/migrations')
      await writeFile(directory, '')
      await assert.rejects(
        () => configure(command),
        `password_confirmations: cannot inspect ${directory}`
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uses the AdonisJS migration directory fallback and warns about existing ordering', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'confirm-inspect-'))
    try {
      const { command, migrations, warnings } = inspectionCommand(root, {
        connection: 'primary',
        connections: { primary: {} },
      })
      await configure(command)
      assert.lengthOf(migrations, 1)
      assert.include(migrations[0], join(root, 'host/migrations'))
      const directory = join(root, 'host/migrations')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, '1000000000000_create_password_confirmations_table.ts'), '')
      await writeFile(join(directory, '1000000000001_account_kit_create_account_sessions.ts'), '')
      migrations.length = 0
      await configure(command)
      assert.lengthOf(migrations, 0)
      assert.isTrue(
        warnings.some((message) =>
          message.includes('must sort after 1000000000001_account_kit_create_account_sessions.ts')
        )
      )
      await writeFile(join(directory, '1000000000002_create_password_confirmations_table.ts'), '')
      await assert.rejects(() => configure(command), /multiple existing confirmations migrations/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('diagnoses invalid, ambiguous and unreadable database configuration before writes', async ({
    assert,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'confirm-inspect-'))
    try {
      const path = join(root, 'config/database.json')
      await mkdir(join(root, 'config'))
      const { command, migrations } = inspectionCommand(root)
      await writeFile(path, '{ not JSON }')
      await assert.rejects(() => configure(command), `password_confirmations: cannot load ${path}`)
      await writeFile(path, JSON.stringify({ connection: 'missing', connections: {} }))
      await assert.rejects(() => configure(command), /no primary connection/)
      await writeFile(
        path,
        JSON.stringify({
          connection: 'primary',
          connections: { primary: { migrations: { paths: [''] } } },
        })
      )
      await assert.rejects(
        () => configure(command),
        /migrations.paths must contain directory names/
      )
      assert.lengthOf(migrations, 0)
      await writeFile(
        path,
        JSON.stringify({
          connection: 'primary',
          connections: { primary: { migrations: { paths: ['schema'] } } },
        })
      )
      await configure(command)
      assert.include(migrations[0], join(root, 'schema'))
      await writeFile(join(root, 'config/database.ts'), 'export default {}')
      await assert.rejects(() => configure(command), /multiple database config files/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('honours --user-id-type and refuses bad flags', async ({ assert }) => {
    const { root, ignitor } = await prepareConfiguredAppRoot()
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
      // An inherited Object key is not a user id type; nothing is written.
      await ignitor
        .ace()
        .handle([
          'configure',
          '@kevinjohn/adonisjs-confirm-action-with-password',
          '--user-id-type=constructor',
        ])
      assert.equal(process.exitCode, 1)
      process.exitCode = undefined
      assert.lengthOf(await readdir(join(root, 'database/migrations')), 1)
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
