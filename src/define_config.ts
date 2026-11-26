/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import string from '@adonisjs/core/helpers/string'
import { InvalidArgumentsException } from '@adonisjs/core/exceptions'
import { isSqlIdentifier } from './sql_identifier.ts'
import type { PasswordConfirmationsConfig, ResolvedPasswordConfirmationsConfig } from './types.ts'

function invalidConfig(reason: string, cause?: unknown) {
  return new InvalidArgumentsException(`Invalid config/password_confirmations.ts: ${reason}`, {
    cause,
  })
}

/** Converts a duration into the parser's units and wraps parser errors with their cause. */
function convertDurationToUnits(
  value: unknown,
  parse: (value: string | number) => number,
  reason: string
) {
  if (typeof value !== 'string' && typeof value !== 'number') throw invalidConfig(reason)
  try {
    return parse(value)
  } catch (error) {
    throw invalidConfig(reason, error)
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
    throw invalidConfig('throttle must be an object or false')
  }
  const resolved = { requests: 5, duration: '1 minute', blockDuration: '20 minutes', ...throttle }
  if (!Number.isSafeInteger(resolved.requests) || resolved.requests < 1) {
    throw invalidConfig('throttle.requests must be a positive integer')
  }
  for (const field of ['duration', 'blockDuration'] as const) {
    // The limiter counts whole seconds, so a sub-second value becomes 0 and never expires.
    const reason = `throttle.${field} must be a duration of at least one second`
    const seconds = convertDurationToUnits(resolved[field], string.seconds.parse, reason)
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      throw invalidConfig(reason)
    }
  }
  return resolved
}

/**
 * Validates `config/password_confirmations.ts` and fills in defaults.
 *
 * @throws {InvalidArgumentsException} The config or an option is invalid.
 * @example
 * ```ts
 * import { defineConfig } from '@kevinjohn/adonisjs-confirm-action-with-password'
 *
 * export default defineConfig({ window: '3 minutes' })
 * ```
 */
export function defineConfig(
  config: PasswordConfirmationsConfig = {}
): ResolvedPasswordConfirmationsConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw invalidConfig('the config must be an object')
  }
  const windowMs = convertDurationToUnits(
    config.window ?? '5m',
    string.milliseconds.parse,
    'window must be a positive duration'
  )
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw invalidConfig('window must be a positive duration')
  }
  const table = config.table ?? 'password_confirmations'
  const usersTable = config.usersTable ?? 'users'
  for (const [name, value] of [
    ['table', table],
    ['usersTable', usersTable],
  ]) {
    if (typeof value !== 'string' || !isSqlIdentifier(value)) {
      throw invalidConfig(`${name} must be a plain SQL identifier`)
    }
  }
  for (const name of ['readPasswordHash', 'verifyPassword', 'authorize'] as const) {
    const value = config[name]
    if (value !== undefined && value !== null && typeof value !== 'function') {
      throw invalidConfig(`${name} must be a function`)
    }
  }
  return {
    windowMs,
    table,
    usersTable,
    readPasswordHash: config.readPasswordHash,
    verifyPassword: config.verifyPassword,
    authorize: config.authorize ?? undefined,
    throttle: resolveThrottle(config.throttle),
  }
}
