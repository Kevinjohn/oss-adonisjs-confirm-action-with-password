/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { createHash } from 'node:crypto'
import { InvalidPasswordConfirmationRequestException } from './errors.js'
import type { ConfirmationRequest } from './types.js'

const MAX_NAME = 255

/**
 * Canonical JSON: keys sorted by UTF-16 code unit, JSON values only. Anything JSON cannot round
 * trip (undefined, functions, non-finite numbers, Dates, class instances) is refused rather than
 * coerced, so two different requests never share a hash. `__proto__` is an ordinary own key.
 */
function canonical(value: unknown, depth = 0): string {
  if (depth > 32)
    throw new InvalidPasswordConfirmationRequestException('intent is nested too deeply')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new InvalidPasswordConfirmationRequestException('non-finite number')
    // Integers past 2^53 have already lost precision, so distinct ids could share a hash; send them
    // as strings. -0 hashes as 0 on purpose (JSON.stringify gives "0"): -0 === 0, so no action can
    // tell them apart, and a confirmation for one may be spent with the other.
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new InvalidPasswordConfirmationRequestException('unsafe integer; send it as a string')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidPasswordConfirmationRequestException(
        'intent must contain plain JSON values only'
      )
    }
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const record = value as Record<string, unknown>
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`
  }
  throw new InvalidPasswordConfirmationRequestException(
    'intent must contain plain JSON values only'
  )
}

function name(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME) {
    throw new InvalidPasswordConfirmationRequestException(
      `${field} must be a string of 1-${MAX_NAME} characters`
    )
  }
  return value
}

/** Validates a request and returns its normalized binding: action, scope and intent hash. */
export function bindRequest(request: ConfirmationRequest) {
  const action = name(request.action, 'action')
  const scope = name(request.scope, 'scope')
  if (request.intent === undefined)
    throw new InvalidPasswordConfirmationRequestException('intent is required')
  const intentHash = createHash('sha256')
    .update(canonical({ action, scope, intent: request.intent }))
    .digest('hex')
  return { action, scope, intentHash }
}
