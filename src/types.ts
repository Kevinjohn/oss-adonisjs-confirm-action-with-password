/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import type { Trx, UserId, CurrentAccount } from '@kevinjohn/adonisjs-account-kit/types'

/** What `authentication.withCurrent` hands its callback in Account Kit 0.3.2. */
export interface KitContext {
  account: CurrentAccount
  signInId?: number
  trx: Trx
}

/** The operation a confirmation authorizes: what, where, and the exact request contents. */
export interface ConfirmationRequest {
  /** A stable action name, such as `transfer-ownership`. */
  action: string
  /** The resource the action applies to, such as a company id. */
  scope: string
  /** The exact operation contents. JSON values only; bound by a canonical SHA-256 hash. */
  intent: unknown
}

/** `ConfirmationRequest` plus the password the user typed to confirm it. */
export interface ConfirmPasswordRequest extends ConfirmationRequest {
  password: string
}

/** The confirmation a client sends back with the sensitive request. */
export interface ConsumeRequest extends ConfirmationRequest {
  confirmationId: string
}

/** Returned by `confirmPassword`. */
export interface IssuedConfirmation {
  confirmationId: string
  /** When the confirmation stops being spendable, as epoch milliseconds. */
  expiresAt: number
}

/** Host policy, re-run under the Account Kit lock at both issuance stages and at spend. */
export type AuthorizeConfirmation = (
  context: KitContext,
  request: ConfirmationRequest
) => Promise<boolean>

/** Options for `config/password_confirmations.ts`. */
export interface PasswordConfirmationsConfig {
  /** How long a confirmation stays spendable after the password check. Default `'5m'`. */
  window?: string | number
  /** The confirmations table. Default `password_confirmations`. */
  table?: string
  /** The users table Account Kit manages. Default `users`. */
  usersTable?: string
  /**
   * Reads the stored password hash through the Kit transaction. Default: the `password` column of
   * `usersTable`, which every Account Kit users adapter requires.
   */
  readPasswordHash?: (userId: UserId, trx: Trx) => Promise<string | null>
  /**
   * Checks a password against the stored hash. Default: the application's hash service. Return
   * false for a wrong or malformed password; a throw is rethrown and refunds the attempt.
   */
  verifyPassword?: (hashed: string, password: string) => Promise<boolean>
  /** Host policy such as "only the owner, never while masquerading". Default allows. */
  authorize?: AuthorizeConfirmation
  /**
   * Failed password confirmations allowed per account through the app's `@adonisjs/limiter`
   * before it is blocked. Default 5 per minute, then blocked for 20 minutes (Account Kit's login
   * identity budget). `false` turns throttling off; the host must then throttle the route.
   */
  throttle?: false | Partial<ConfirmationThrottle>
}

/** A failed-attempt budget for `confirmPassword`. */
export interface ConfirmationThrottle {
  requests: number
  duration: string | number
  blockDuration: string | number
}

/** `PasswordConfirmationsConfig` with every default filled in. */
export interface ResolvedPasswordConfirmationsConfig {
  windowMs: number
  table: string
  usersTable: string
  readPasswordHash?: PasswordConfirmationsConfig['readPasswordHash']
  verifyPassword?: PasswordConfirmationsConfig['verifyPassword']
  authorize: AuthorizeConfirmation
  throttle: false | ConfirmationThrottle
}
