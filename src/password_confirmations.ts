/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Database } from '@adonisjs/lucid/database'
import { errors as limiterErrors } from '@adonisjs/limiter'
import type { Limiter } from '@adonisjs/limiter'
import type { CurrentAccountInput, Trx, UserId } from '@kevinjohn/adonisjs-account-kit/types'
import { buildConfirmationBinding } from './intent_hash.js'
import {
  E_PASSWORD_CONFIRMATION_DENIED,
  E_PASSWORD_CONFIRMATION_PASSWORD_UNAVAILABLE,
  E_PASSWORD_CONFIRMATION_PASSWORD_HASH_MISSING,
  E_PASSWORD_CONFIRMATION_PASSWORD_INPUT_INVALID,
  E_PASSWORD_CONFIRMATION_FORBIDDEN,
  E_PASSWORD_CONFIRMATION_REQUIRED,
  E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED,
  E_PASSWORD_CONFIRMATION_BINDING_REJECTED,
  E_PASSWORD_CONFIRMATION_STALE,
  E_PASSWORD_CONFIRMATION_THROTTLED,
  E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED,
  E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
} from './errors.js'
import type {
  IssuedConfirmation,
  KitContext,
  ConfirmationRequest,
  ConfirmPasswordRequest,
  ResolvedPasswordConfirmationsConfig,
  ConsumeRequest,
  PasswordConfirmationsDependencies,
} from './types.js'

export type { PasswordConfirmationsDependencies } from './types.js'

function snapshotCurrentAccount(input: CurrentAccountInput): CurrentAccountInput {
  return {
    userId: input.userId,
    revision: input.revision,
    tokenId: input.tokenId,
    sessionHandle: input.sessionHandle,
  }
}

function extractAffectedRowCount(result: unknown) {
  return Array.isArray(result) ? Number(result[0]) : Number(result)
}

/**
 * Ask for the password again before a sensitive operation, built on Account Kit's public
 * `authentication.withCurrent`. Issuance reads and writes under the account lock in two Kit
 * transactions; password verification and limiter storage occur outside them. Spending requires
 * the active Kit transaction and rolls back with the protected write. Pruning uses the database
 * directly, independently of the account lock.
 *
 * @example
 * ```ts
 * import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
 *
 * const confirmationWindowMs = passwordConfirmations.windowMs
 * ```
 */
export class PasswordConfirmations {
  readonly #accountKit: PasswordConfirmationsDependencies['kit']
  readonly #db: Database
  readonly #config: ResolvedPasswordConfirmationsConfig
  readonly #verifyPassword: PasswordConfirmationsDependencies['verifyPassword']
  readonly #readNow: () => number
  readonly #throttle?: Limiter

  constructor(dependencies: PasswordConfirmationsDependencies) {
    this.#accountKit = dependencies.kit
    this.#db = dependencies.db
    this.#config = dependencies.config
    this.#verifyPassword = dependencies.config.verifyPassword ?? dependencies.verifyPassword
    this.#readNow = dependencies.now ?? Date.now
    const throttle = dependencies.config.throttle
    if (throttle) {
      if (!dependencies.limiter) {
        throw new E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED()
      }
      // No blockDuration here: the store would block again each time a throttled retry crosses the
      // limit, extending the block for as long as the user keeps trying. #recordPasswordFailure is the only
      // place a block starts, after a wrong password.
      this.#throttle = dependencies.limiter.use({
        requests: throttle.requests,
        duration: throttle.duration,
      })
    }
  }

  /** How long a confirmation stays spendable after the password check, in milliseconds. */
  get windowMs() {
    return this.#config.windowMs
  }

  async #assertConfirmationAllowed(context: KitContext, request: ConfirmationRequest) {
    // Host authorisation sees only what the confirmation binds: never the password or confirmation id.
    const { action, scope, intent } = request
    const authorize = this.#config.authorize ?? (async () => true)
    if ((await authorize(context, { action, scope, intent })) !== true) {
      throw new E_PASSWORD_CONFIRMATION_FORBIDDEN()
    }
  }

  /**
   * Three fixed-width keys per account, so a long string id cannot outgrow the limiter store's key
   * column. `attemptKey` counts reservations (checks in flight plus wrong passwords) and caps the
   * hashes a burst can run; `failureKey` counts completed wrong passwords only; `blockKey` is the block
   * they arm. A refund touches `attemptKey` alone, so it can neither erase a failure nor open a block.
   */
  #buildThrottleKeys(userId: UserId) {
    const userIdHash = createHash('sha256').update(String(userId)).digest('hex')
    const attemptKey = `password_confirmations:${userIdHash}`
    return { attemptKey, failureKey: `${attemptKey}:failed`, blockKey: `${attemptKey}:blocked` }
  }

  /** Account Kit's sign-in pattern: consume first, refuse when the budget is gone. */
  async #reserveAttempt(keys: { attemptKey: string; blockKey: string }) {
    const block = await this.#throttle!.get(keys.blockKey)
    if (block && block.consumed > 0) {
      throw new E_PASSWORD_CONFIRMATION_THROTTLED(block.availableIn)
    }
    const key = keys.attemptKey
    try {
      await this.#throttle!.consume(key)
    } catch (error) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        if (error.response.consumed > error.response.limit) await this.#throttle!.decrement(key)
        throw new E_PASSWORD_CONFIRMATION_THROTTLED(error.response.availableIn)
      }
      throw error
    }
  }

  /**
   * Counts a completed wrong password and blocks for `blockDuration` once `requests` of them have
   * completed. Checks still in flight are not failures: they do not arm the block. The block has
   * its own key, so a throttled retry never extends it.
   */
  async #recordPasswordFailure(keys: { attemptKey: string; failureKey: string; blockKey: string }) {
    const throttle = this.#config.throttle
    const failureIncrement = await this.#throttle!.increment(keys.failureKey)
    if (throttle && failureIncrement.consumed >= throttle.requests) {
      await this.#throttle!.set(keys.blockKey, 1, throttle.blockDuration)
      // From here the block alone decides, for exactly blockDuration. Left in place, a spent
      // budget would keep refusing after a block shorter than the counting window had lapsed.
      await Promise.all([
        this.#throttle!.delete(keys.attemptKey),
        this.#throttle!.delete(keys.failureKey),
      ])
    }
  }

  #requireSignInId(context: KitContext) {
    if (context.signInId === undefined)
      throw new E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED()
    return context.signInId
  }

  async #readPasswordHash(userId: UserId, trx: Trx) {
    if (this.#config.readPasswordHash) return this.#config.readPasswordHash(userId, trx)
    const row = await trx
      .from(this.#config.usersTable)
      .select('password')
      .where('id', userId)
      .first()
    return typeof row?.password === 'string' ? row.password : null
  }

  /**
   * Checks the current password and issues a confirmation bound to this sign-in, the account's credential
   * revision, and the exact request. Stage 1 snapshots the hash under the Kit lock; the slow hash
   * runs outside any transaction; stage 2 re-runs `withCurrent` with the same `input`, so the Kit
   * re-checks the sign-in and credential revision, and issues only while the window holds.
   *
   * @example
   * ```ts
   * const { confirmationId, expiresAt } = await passwordConfirmations.confirmPassword(input, {
   *   action: 'transfer-ownership',
   *   scope: companyId,
   *   intent: { toUserId },
   *   password,
   * })
   * ```
   * @throws {AggregateError} Password verification and refund both fail; `errors[0]` is the verification fault.
   */
  async confirmPassword(
    input: CurrentAccountInput,
    request: ConfirmPasswordRequest
  ): Promise<IssuedConfirmation> {
    // The Kit reads these fields on every call. A host that refreshes its credential object in
    // place must not move stage two onto another sign-in than the one whose hash was checked.
    const current = snapshotCurrentAccount(input)
    const binding = buildConfirmationBinding(request)
    const issuanceSnapshot = await this.#accountKit.authentication.withCurrent(
      current,
      async (context) => {
        this.#requireSignInId(context)
        await this.#assertConfirmationAllowed(context, request)
        return {
          userId: context.account.id,
          hasPassword: context.account.hasPassword,
          // An account the Kit reports as passwordless cannot confirm with one, whatever is stored:
          // Account Kit's sign-in refuses it too. A null hash is a wrong password and counts as one.
          hash: context.account.hasPassword
            ? await this.#readPasswordHash(context.account.id, context.trx)
            : null,
        }
      }
    )
    // Reserve an attempt atomically before the hash, so a parallel burst cannot run more hashes than
    // the budget (penalize checks then increments, which a burst races through).
    const throttleKeys = this.#buildThrottleKeys(issuanceSnapshot.userId)
    if (this.#throttle) await this.#reserveAttempt(throttleKeys)
    let refusal: InstanceType<typeof E_PASSWORD_CONFIRMATION_DENIED> | undefined
    try {
      if (typeof request.password !== 'string')
        refusal = new E_PASSWORD_CONFIRMATION_PASSWORD_INPUT_INVALID()
      else if (!issuanceSnapshot.hasPassword)
        refusal = new E_PASSWORD_CONFIRMATION_PASSWORD_UNAVAILABLE()
      else if (issuanceSnapshot.hash === null)
        refusal = new E_PASSWORD_CONFIRMATION_PASSWORD_HASH_MISSING()
      else if (!(await this.#verifyPassword(issuanceSnapshot.hash, request.password)))
        refusal = new E_PASSWORD_CONFIRMATION_DENIED()
    } catch (error) {
      // An infrastructure fault is not a wrong guess: give the attempt back. If the refund fails
      // too, report both; whether the attempt is still charged is then unknown.
      try {
        if (this.#throttle) await this.#throttle.decrement(throttleKeys.attemptKey)
      } catch (refundError) {
        throw new AggregateError(
          [error, refundError],
          'Password verification failed and its throttle attempt could not be refunded',
          { cause: error }
        )
      }
      throw error
    }
    if (refusal) {
      if (this.#throttle) await this.#recordPasswordFailure(throttleKeys)
      throw refusal
    }
    // The window runs from the check itself, not from the limiter reset that follows it.
    const verifiedAt = this.#readNow()
    if (this.#throttle) {
      // A correct password resets the budget. No block can exist here: arming one takes `requests`
      // completed failures, and this check held one of the `requests` slots.
      await Promise.all([
        this.#throttle.delete(throttleKeys.attemptKey),
        this.#throttle.delete(throttleKeys.failureKey),
      ])
    }

    return this.#accountKit.authentication.withCurrent(current, async (context) => {
      if (context.account.id !== issuanceSnapshot.userId)
        throw new E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED()
      const signInId = this.#requireSignInId(context)
      await this.#assertConfirmationAllowed(context, request)
      const issuedAt = this.#readNow()
      // The deadline is stored, so a later change to `window` cannot move it for this confirmation.
      const expiresAt = verifiedAt + this.#config.windowMs
      // Same input, so withCurrent has re-checked this sign-in and its credential revision.
      if (issuedAt >= expiresAt) throw new E_PASSWORD_CONFIRMATION_STALE()
      const revision = await context.readCredentialRevision()
      await context.trx
        .from(this.#config.table)
        .where('sign_in_id', signInId)
        .where((query) => {
          query.where('expires_at', '<=', issuedAt).orWhereNotNull('consumed_at')
        })
        .delete()
      const confirmationId = randomUUID()
      await context.trx.table(this.#config.table).insert({
        id: confirmationId,
        user_id: context.account.id,
        sign_in_id: signInId,
        credential_revision: revision,
        action: binding.action,
        scope: binding.scope,
        intent_hash: binding.intentHash,
        verified_at: verifiedAt,
        issued_at: issuedAt,
        expires_at: expiresAt,
        consumed_at: null,
      })
      return { confirmationId, expiresAt }
    })
  }

  /**
   * Spends a confirmation inside the caller's `withCurrent` callback. Session and account come from the
   * Kit's context, the credential revision is read live in the same transaction, so nothing the
   * caller passes besides the confirmation and request can widen its binding. The host remains
   * responsible for resource permission. The spend rolls back with the caller's transaction.
   *
   * @example
   * ```ts
   * await kit.authentication.withCurrent(input, async (context) => {
   *   await passwordConfirmations.consume(context, {
   *     confirmationId,
   *     action: 'transfer-ownership',
   *     scope: companyId,
   *     intent: { toUserId },
   *   })
   *   await transferOwnership(context, companyId, toUserId)
   * })
   * ```
   */
  async consume(context: KitContext, request: ConsumeRequest) {
    const signInId = this.#requireSignInId(context)
    const binding = buildConfirmationBinding(request)
    await this.#assertConfirmationAllowed(context, request)
    if (typeof request.confirmationId !== 'string' || request.confirmationId === '') {
      throw new E_PASSWORD_CONFIRMATION_REQUIRED()
    }
    const now = this.#readNow()
    const revision = await context.readCredentialRevision()
    const query = context.trx
      .from(this.#config.table)
      .where({
        id: request.confirmationId,
        user_id: context.account.id,
        sign_in_id: signInId,
        action: binding.action,
        scope: binding.scope,
        intent_hash: binding.intentHash,
      })
      .whereNull('consumed_at')
      // Never past the deadline that was returned, even if `window` has since grown...
      .where('expires_at', '>', now)
      // ...and a `window` that has since shrunk applies at once.
      .where('verified_at', '>', now - this.#config.windowMs)
    // A confirmation issued before any credential change stays valid while none has happened;
    // null never matches a non-null revision.
    if (revision === null) query.whereNull('credential_revision')
    else query.where('credential_revision', revision)
    if (extractAffectedRowCount(await query.update({ consumed_at: now })) !== 1) {
      throw new E_PASSWORD_CONFIRMATION_BINDING_REJECTED()
    }
  }

  /**
   * Spends the confirmation and runs the protected operation in one account transaction.
   * Prefer this over calling `consume` directly.
   *
   * @example
   * ```ts
   * await passwordConfirmations.withConfirmation(
   *   input,
   *   { confirmationId, action: 'transfer-ownership', scope: companyId, intent: { toUserId } },
   *   async (context) => transferOwnership(context, companyId, toUserId)
   * )
   * ```
   */
  withConfirmation<T>(
    input: CurrentAccountInput,
    request: ConsumeRequest,
    run: (context: KitContext) => Promise<T>
  ): Promise<T> {
    return this.#accountKit.authentication.withCurrent(
      snapshotCurrentAccount(input),
      async (context) => {
        await this.consume(context, request)
        return run(context)
      }
    )
  }

  /**
   * Deletes spent and expired confirmations. Schedule it; returns the number of rows removed.
   *
   * @example
   * ```ts
   * const removed = await passwordConfirmations.prune()
   * ```
   */
  async prune() {
    return extractAffectedRowCount(
      await this.#db
        .from(this.#config.table)
        .where('expires_at', '<=', this.#readNow())
        .orWhereNotNull('consumed_at')
        .delete()
    )
  }
}
