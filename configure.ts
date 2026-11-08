/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type Configure from '@adonisjs/core/commands/configure'
import { isSqlIdentifier } from './src/sql_identifier.js'

/** The package's stub directory, next to this file in source and in `build/`. */
export const stubsRoot = fileURLToPath(new URL('./stubs/', import.meta.url))

const userIdColumns: Record<string, string> = {
  integer: `table.integer('user_id').unsigned()`,
  string: `table.string('user_id', 254)`,
  uuid: `table.uuid('user_id')`,
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
  if (!isSqlIdentifier(usersTable) || !isSqlIdentifier(tableName) || !userIdColumns[userIdType]) {
    command.exitCode = 1
    command.logger.logError(
      'password_confirmations: --users-table and --table must be plain SQL identifiers and --user-id-type integer, string or uuid'
    )
    return
  }
  const codemods = await command.createCodemods()
  codemods.overwriteExisting = false
  await codemods.makeUsingStub(stubsRoot, 'config/password_confirmations.stub', { tableName })

  const suffix = '_create_password_confirmations_table.ts'
  let existing: string[] = []
  try {
    existing = await readdir(command.app.makePath('database/migrations'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  // The confirmations table references Account Kit's account_sessions, so its migration must run after the
  // Kit's (PostgreSQL rejects a foreign key to a table that does not exist yet).
  if (!existing.some((file) => file.endsWith('_account_kit_create_account_sessions.ts'))) {
    command.logger.warning(
      'password_confirmations: run node ace configure @kevinjohn/adonisjs-account-kit first; the confirmations migration must sort after its account_sessions migration'
    )
  }
  if (existing.some((file) => file.endsWith(suffix))) {
    command.logger.info(`Skipped database/migrations/*${suffix}`)
  } else {
    await codemods.makeUsingStub(stubsRoot, 'migrations/create_password_confirmations_table.stub', {
      migration: {
        tableName,
        usersTable,
        userIdColumn: userIdColumns[userIdType],
        destination: command.app.makePath(`database/migrations/${Date.now()}${suffix}`),
      },
    })
  }
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider(
      '@kevinjohn/adonisjs-confirm-action-with-password/password_confirmations_provider'
    )
  })
}
