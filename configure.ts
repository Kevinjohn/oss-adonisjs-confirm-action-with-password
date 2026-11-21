/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type Configure from '@adonisjs/core/commands/configure'
import { RuntimeException } from '@adonisjs/core/exceptions'
import type { DatabaseConfig } from '@adonisjs/lucid/types/database'
import { isSqlIdentifier } from './src/sql_identifier.js'

/** The package's stub directory, next to this file in source and in `build/`. */
export const stubsRoot = fileURLToPath(new URL('./stubs/', import.meta.url))

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
async function migrationDirectory(command: Configure): Promise<string> {
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
  if (!database) return app.migrationsPath()
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
  if (paths.length > 1) {
    throw new RuntimeException(
      'password_confirmations: multiple migration paths on the primary connection; configure with one migration directory, or install the stub manually after the Account Kit migrations'
    )
  }
  return paths.length === 1 ? resolve(app.makePath(), paths[0]) : app.migrationsPath()
}

/**
 * `node ace configure @kevinjohn/adonisjs-confirm-action-with-password`: writes `config/password_confirmations.ts`, the
 * confirmations migration and registers the provider. Never overwrites existing files. Flags match
 * Account Kit's: `--users-table` and `--user-id-type` (`integer`, `string` or `uuid`), plus
 * `--table` for the confirmations table, written to both the migration and the config.
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
  const directory = await migrationDirectory(command)
  const migrationFileNames = (await inspect(directory, () => readdir(directory))) ?? []
  const suffix = '_create_password_confirmations_table.ts'
  const existingMigrations = migrationFileNames.filter((file) => file.endsWith(suffix))
  if (existingMigrations.length > 1) {
    throw new RuntimeException(
      `password_confirmations: multiple existing confirmations migrations in ${directory}`
    )
  }
  const codemods = await command.createCodemods()
  codemods.overwriteExisting = false
  // Existing files are never rewritten, so a rerun with other flags must say what it left alone.
  const warnIfExistingConfigDiffers = async (path: string, expectedSnippets: string[]) => {
    const source = await inspect(path, () => readFile(path, 'utf8'))
    if (source !== undefined && !expectedSnippets.every((text) => source.includes(text))) {
      command.logger.warning(
        `password_confirmations: ${path} already exists and does not match --table ${tableName} / --users-table ${usersTable} / --user-id-type ${userIdType}; it was left unchanged`
      )
    }
  }
  await warnIfExistingConfigDiffers(command.app.configPath('password_confirmations.ts'), [
    `table: '${tableName}'`,
    `usersTable: '${usersTable}'`,
  ])
  const existingConfirmationMigration = existingMigrations[0]
  if (existingConfirmationMigration) {
    await warnIfExistingConfigDiffers(join(directory, existingConfirmationMigration), [
      `tableName = '${tableName}'`,
      `inTable('${usersTable}')`,
      userIdColumns[userIdType],
    ])
  }
  await codemods.makeUsingStub(stubsRoot, 'config/password_confirmations.stub', {
    tableName,
    usersTable,
  })
  // The confirmations table references Account Kit's account_sessions, so its migration must run after the
  // Kit's (PostgreSQL rejects a foreign key to a table that does not exist yet).
  const sessionsMigration = migrationFileNames.find((file) =>
    file.endsWith('_account_kit_create_account_sessions.ts')
  )
  if (!sessionsMigration) {
    command.logger.warning(
      'password_confirmations: run node ace configure @kevinjohn/adonisjs-account-kit first; the confirmations migration must sort after its account_sessions migration'
    )
  }
  if (existingConfirmationMigration) {
    if (sessionsMigration && existingConfirmationMigration <= sessionsMigration) {
      command.logger.warning(
        `password_confirmations: ${existingConfirmationMigration} must sort after ${sessionsMigration}; check migration history before making any changes`
      )
    }
    command.logger.info(`Skipped ${join(directory, existingConfirmationMigration)}`)
  } else {
    // Sort after every existing migration even when one carries a timestamp ahead of this clock.
    const newest = Math.max(...migrationFileNames.map((file) => Number.parseInt(file, 10) || 0))
    const prefix = Math.max(Date.now(), newest + 1)
    await codemods.makeUsingStub(stubsRoot, 'migrations/create_password_confirmations_table.stub', {
      migration: {
        tableName,
        usersTable,
        userIdColumn: userIdColumns[userIdType],
        destination: join(directory, `${prefix}${suffix}`),
      },
    })
  }
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider(
      '@kevinjohn/adonisjs-confirm-action-with-password/password_confirmations_provider'
    )
  })
}
