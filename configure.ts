/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { lstat, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type Configure from '@adonisjs/core/commands/configure'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { sourceFiles } from '@adonisjs/lucid/utils'
import type { DatabaseConfig } from '@adonisjs/lucid/types/database'
import { isSqlIdentifier } from './src/sql_identifier.ts'
import { stubsRoot } from './stubs/main.ts'

const userIdColumns: Record<string, string> = {
  integer: `table.integer('user_id').unsigned()`,
  string: `table.string('user_id', 254)`,
  uuid: `table.uuid('user_id')`,
}

/** A missing file is normal on a fresh install; all other inspection failures are actionable. */
async function inspect<T>(path: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new RuntimeException(`password_confirmations: cannot inspect ${path}`, { cause: error })
  }
}

/** Configure does not boot the app; read Lucid's primary connection config without booting it. */
async function resolveMigrationSettings(command: Configure) {
  const app = command.app
  let database = app.config?.get<DatabaseConfig>('database')
  if (!database) {
    const paths = ['ts', 'js', 'mjs', 'cjs', 'json'].map((extension) =>
      app.configPath(`database.${extension}`)
    )
    const candidates: string[] = []
    for (const path of paths) {
      if (await inspect(path, () => stat(path))) candidates.push(path)
    }
    if (candidates.length > 1) {
      throw new RuntimeException(
        `password_confirmations: multiple database config files: ${candidates.join(', ')}`
      )
    }
    const path = candidates[0]
    if (path) {
      try {
        if (path.endsWith('.json')) {
          database = JSON.parse(await readFile(path, 'utf8')) as DatabaseConfig
        } else {
          const module = await app.import(pathToFileURL(path).href)
          // The AdonisJS config loader accepts default or named exports.
          database = (module.default ?? { ...module }) as DatabaseConfig
        }
      } catch (error) {
        throw new RuntimeException(`password_confirmations: cannot load ${path}`, { cause: error })
      }
      if (!database)
        throw new RuntimeException(`password_confirmations: invalid database config in ${path}`)
    }
  }
  if (!database) return { directories: [app.migrationsPath()], naturalSort: false }
  const connection = database.connections?.[database.connection]
  if (!connection) {
    throw new RuntimeException('password_confirmations: config/database has no primary connection')
  }
  const paths = connection.migrations?.paths ?? []
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.trim())) {
    throw new RuntimeException(
      'password_confirmations: config/database migrations.paths must contain directory names'
    )
  }
  return {
    directories: paths.length
      ? paths.map((path) => fileURLToPath(new URL(path, app.appRoot)))
      : [app.migrationsPath()],
    naturalSort: connection.migrations?.naturalSort ?? false,
  }
}

/**
 * `node ace configure @kevinjohn/adonisjs-confirm-action-with-password`: writes `config/password_confirmations.ts`, the
 * confirmations migration and registers the provider. Never overwrites existing files. Flags match
 * Account Kit's: `--users-table` and `--user-id-type` (`integer`, `string` or `uuid`), plus
 * `--table` for the confirmations table, written to both the migration and the config.
 *
 * @throws {RuntimeException} An existing config or migration path cannot be inspected safely.
 * @example
 * ```ts
 * import { configure } from '@kevinjohn/adonisjs-confirm-action-with-password'
 *
 * await configure(command)
 * ```
 */
export async function configure(command: Configure) {
  const usersTable = String(command.parsedFlags['users-table'] ?? 'users')
  const userIdType = String(command.parsedFlags['user-id-type'] ?? 'integer')
  const tableName = String(command.parsedFlags['table'] ?? 'password_confirmations')
  if (
    !isSqlIdentifier(usersTable) ||
    !isSqlIdentifier(tableName) ||
    !Object.hasOwn(userIdColumns, userIdType)
  ) {
    command.exitCode = 1
    command.logger.logError(
      'password_confirmations: --users-table and --table must be plain SQL identifiers and --user-id-type integer, string or uuid'
    )
    return
  }
  const { directories, naturalSort } = await resolveMigrationSettings(command)
  // Lucid runs each path in order, sorting the files within it.
  const migrations: { directory: string; name: string }[] = []
  for (const directory of directories) {
    const { files } = (await inspect(directory, async () => {
      const info = await stat(directory)
      if (!info.isDirectory()) throw new RuntimeException('Expected a migration directory')
      return sourceFiles(pathToFileURL(directory + sep), '.', naturalSort)
    })) ?? { files: [] }
    for (const file of files)
      migrations.push({ directory, name: relative(directory, file.absPath) })
  }
  const buildMigrationPath = (migration: { directory: string; name: string }) =>
    join(migration.directory, migration.name)
  const suffix = '_create_password_confirmations_table'
  const sessionsSuffix = '_account_kit_create_account_sessions'
  const hasSuffix = (file: string, name: string) => basename(file, extname(file)).endsWith(name)
  const jsonMigration = migrations.find(
    ({ name }) =>
      extname(name) === '.json' && (hasSuffix(name, suffix) || hasSuffix(name, sessionsSuffix))
  )
  if (jsonMigration) {
    throw new RuntimeException(
      `password_confirmations: ${buildMigrationPath(jsonMigration)} is JSON and cannot run as a migration; install a schema module manually and check migration history before rerunning configure`
    )
  }
  const existingMigrations = migrations.filter(({ name }) => hasSuffix(name, suffix))
  if (existingMigrations.length > 1) {
    throw new RuntimeException(
      `password_confirmations: multiple existing confirmations migrations in ${directories.join(', ')}`
    )
  }
  const existingConfirmationMigration = existingMigrations[0]
  // Sessions must precede confirmations. Place a fresh child after the last Lucid migration
  // in its directory so relative-path sorting cannot put the child before a nested parent.
  const sessionsMigration = migrations.findLast(({ name }) => hasSuffix(name, sessionsSuffix))
  let destination: string | undefined
  // A migration configure cannot place is skipped; the config and provider are still written.
  const refuseMigration = (reason: string) => {
    command.exitCode = 1
    command.logger.logError(
      `password_confirmations: ${reason}. The migration was not written; the stub is ${join(stubsRoot, 'migrations/create_password_confirmations_table.stub')} (see "Install the migration manually" in the README)`
    )
  }
  if (!existingConfirmationMigration && directories.length > 1) {
    refuseMigration(
      'multiple migration paths on the primary connection and none holds a confirmations migration; configure with one migration directory, or install the stub manually after the Account Kit migrations'
    )
  } else if (!existingConfirmationMigration) {
    const [directory] = directories
    const last = migrations.at(-1)?.name
    let newest = BigInt(Date.now()) - 1n
    for (const { name } of migrations) {
      const prefix = BigInt(/^(\d+)/.exec(basename(name))?.[1] ?? '0')
      if (prefix > newest) newest = prefix
    }
    const filename = join(last ? dirname(last) : '.', `${newest + 1n}${suffix}.ts`)
    const followsLast =
      last === undefined ||
      (naturalSort
        ? last.localeCompare(filename, undefined, { numeric: true, sensitivity: 'base' }) < 0
        : last < filename)
    const path = join(directory, filename)
    if (!followsLast || (await inspect(path, () => lstat(path)))) {
      refuseMigration(
        `cannot safely place a migration at ${path}; install the stub manually after the Account Kit migrations without renaming existing migrations`
      )
    } else {
      destination = path
    }
  }
  const codemods = await command.createCodemods()
  codemods.overwriteExisting = false
  // Existing files are never rewritten, so a rerun with other flags must say what it left alone.
  const warnIfExistingConfigDiffers = async (
    path: string,
    expected: Array<string | ((source: string) => boolean)>
  ) => {
    const source = await inspect(path, () => readFile(path, 'utf8'))
    if (
      source !== undefined &&
      !expected.every((check) =>
        typeof check === 'string' ? source.includes(check) : check(source)
      )
    ) {
      command.logger.warning(
        `password_confirmations: ${path} already exists and does not match --table ${tableName} / --users-table ${usersTable} / --user-id-type ${userIdType}; it was left unchanged`
      )
    }
  }
  // `defineConfig` fills in an absent key with its default, so absence matches the default flag.
  const createConfigKeyMatcher =
    (key: string, value: string, fallback: string) => (source: string) =>
      source.includes(`${key}: '${value}'`) ||
      (value === fallback && !new RegExp(`\\b${key}\\s*:`).test(source))
  await warnIfExistingConfigDiffers(command.app.configPath('password_confirmations.ts'), [
    createConfigKeyMatcher('table', tableName, 'password_confirmations'),
    createConfigKeyMatcher('usersTable', usersTable, 'users'),
  ])
  if (existingConfirmationMigration) {
    await warnIfExistingConfigDiffers(buildMigrationPath(existingConfirmationMigration), [
      `tableName = '${tableName}'`,
      `inTable('${usersTable}')`,
      userIdColumns[userIdType],
    ])
  }
  await codemods.makeUsingStub(stubsRoot, 'config/password_confirmations.stub', {
    tableName,
    usersTable,
  })
  if (!sessionsMigration) {
    command.logger.warning(
      'password_confirmations: run node ace configure @kevinjohn/adonisjs-account-kit first; the confirmations migration must sort after its account_sessions migration'
    )
  }
  if (existingConfirmationMigration) {
    if (
      sessionsMigration &&
      migrations.indexOf(existingConfirmationMigration) <= migrations.indexOf(sessionsMigration)
    ) {
      command.logger.warning(
        `password_confirmations: ${existingConfirmationMigration.name} must sort after ${sessionsMigration.name}; check migration history before making any changes`
      )
    }
    command.logger.info(`Skipped ${buildMigrationPath(existingConfirmationMigration)}`)
  } else if (destination) {
    await codemods.makeUsingStub(stubsRoot, 'migrations/create_password_confirmations_table.stub', {
      migration: {
        tableName,
        usersTable,
        userIdColumn: userIdColumns[userIdType],
        path: relative(command.app.migrationsPath(), destination),
      },
    })
  }
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider(
      '@kevinjohn/adonisjs-confirm-action-with-password/password_confirmations_provider'
    )
  })
}
