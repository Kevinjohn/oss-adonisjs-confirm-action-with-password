/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import string from '@adonisjs/core/helpers/string'
import { InvalidPasswordConfirmationsConfigException } from './errors.js'
import { isSqlIdentifier } from './sql_identifier.js'
import type { PasswordConfirmationsConfig, ResolvedPasswordConfirmationsConfig } from './types.js'

/** Parses a duration option, keeping the parser's error as the cause of the diagnostic. */
function parseDuration(value: unknown, parse: (value: string | number) => number, reason: string) {
  const invalid = (cause?: unknown) => {
    const error = new InvalidPasswordConfirmationsConfigException(reason)
    if (cause !== undefined) error.cause = cause
    return error
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw invalid()
  try {
    return parse(value)
  } catch (error) {
    throw invalid(error)
  }
}

function resolveThrottle(throttle: PasswordConfirmationsConfig['throttle']) {
  if (throttle === false) return false
  // An absent value (undefined or null) means the default, as for every other option.
  if (
    throttle !== undefined &&
    throttle !== null &&
    (typeof throttle !== 'object' || Array.isArray(throttle))
  ) {
    throw new InvalidPasswordConfirmationsConfigException('throttle must be an object or false')
  }
  const resolved = { requests: 5, duration: '1 minute', blockDuration: '20 minutes', ...throttle }
  if (!Number.isSafeInteger(resolved.requests) || resolved.requests < 1) {
    throw new InvalidPasswordConfirmationsConfigException(
      'throttle.requests must be a positive integer'
    )
  }
  for (const field of ['duration', 'blockDuration'] as const) {
    // The limiter counts whole seconds, so a sub-second value becomes 0 and never expires.
    const reason = `throttle.${field} must be a duration of at least one second`
    const seconds = parseDuration(resolved[field], string.seconds.parse, reason)
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      throw new InvalidPasswordConfirmationsConfigException(reason)
    }
  }
  return resolved
}

/** Validates `config/password_confirmations.ts` and fills in defaults. */
export function defineConfig(
  config: PasswordConfirmationsConfig = {}
): ResolvedPasswordConfirmationsConfig {
  if (typeof config !== 'object' || config === null) {
    throw new InvalidPasswordConfirmationsConfigException('the config must be an object')
  }
  const windowMs = parseDuration(
    config.window ?? '5m',
    string.milliseconds.parse,
    'window must be a positive duration'
  )
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new InvalidPasswordConfirmationsConfigException('window must be a positive duration')
  }
  const table = config.table ?? 'password_confirmations'
  const usersTable = config.usersTable ?? 'users'
  for (const [name, value] of [
    ['table', table],
    ['usersTable', usersTable],
  ]) {
    if (typeof value !== 'string' || !isSqlIdentifier(value)) {
      throw new InvalidPasswordConfirmationsConfigException(
        `${name} must be a plain SQL identifier`
      )
    }
  }
  for (const name of ['readPasswordHash', 'verifyPassword', 'authorize'] as const) {
    const value = config[name]
    if (value !== undefined && value !== null && typeof value !== 'function') {
      throw new InvalidPasswordConfirmationsConfigException(`${name} must be a function`)
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
