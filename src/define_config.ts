/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import string from '@adonisjs/core/helpers/string'
import { InvalidPasswordConfirmationsConfigException } from './errors.js'
import { isSqlIdentifier } from './sql_identifier.js'
import type { PasswordConfirmationsConfig, ResolvedPasswordConfirmationsConfig } from './types.js'

function resolveThrottle(throttle: PasswordConfirmationsConfig['throttle']) {
  if (throttle === false) return false
  const resolved = { requests: 5, duration: '1 minute', blockDuration: '20 minutes', ...throttle }
  if (!Number.isSafeInteger(resolved.requests) || resolved.requests < 1) {
    throw new InvalidPasswordConfirmationsConfigException(
      'throttle.requests must be a positive integer'
    )
  }
  return resolved
}

/** Validates `config/password_confirmations.ts` and fills in defaults. */
export function defineConfig(
  config: PasswordConfirmationsConfig = {}
): ResolvedPasswordConfirmationsConfig {
  let windowMs: number
  try {
    windowMs = string.milliseconds.parse(config.window ?? '5m')
  } catch {
    windowMs = Number.NaN
  }
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new InvalidPasswordConfirmationsConfigException('window must be a positive duration')
  }
  const table = config.table ?? 'password_confirmations'
  const usersTable = config.usersTable ?? 'users'
  for (const [name, value] of [
    ['table', table],
    ['usersTable', usersTable],
  ]) {
    if (!isSqlIdentifier(value)) {
      throw new InvalidPasswordConfirmationsConfigException(
        `${name} must be a plain SQL identifier`
      )
    }
  }
  return {
    windowMs,
    table,
    usersTable,
    readPasswordHash: config.readPasswordHash,
    verifyPassword: config.verifyPassword,
    authorize: config.authorize ?? (async () => true),
    throttle: resolveThrottle(config.throttle),
  }
}
