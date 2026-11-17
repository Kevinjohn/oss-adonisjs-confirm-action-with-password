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
import type { Limiter, LimiterManager } from '@adonisjs/limiter'
import type { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import type { CurrentAccountInput, Trx, UserId } from '@kevinjohn/adonisjs-account-kit/types'
import { liveCredentialRevision } from './credential_revision.js'
import { bindRequest } from './intent_hash.js'
import {
  PasswordConfirmationDeniedException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationsConfigException,
  SessionRegistryRequiredException,
} from './errors.js'
import type {
  IssuedConfirmation,
  KitContext,
  ConfirmationRequest,
  ConfirmPasswordRequest,
  ResolvedPasswordConfirmationsConfig,
  ConsumeRequest,
} from './types.js'

export interface PasswordConfirmationsDependencies {
  kit: Pick<AccountKit, 'authentication'>
  db: Database
  config: ResolvedPasswordConfirmationsConfig
  /** Used when the config gives no `verifyPassword`; the provider passes the app hash service. */
  verifyPassword: (hashed: string, password: string) => Promise<boolean>
  /** The app's limiter manager; required unless `throttle` is false. */
  limiter?: Pick<LimiterManager<any>, 'use'>
  /** Epoch milliseconds. Injectable for tests. */
  now?: () => number
}

function affected(result: unknown) {
  return Array.isArray(result) ? Number(result[0]) : Number(result)
}

/**
 * Ask for the password again before a sensitive action, built on Account Kit's public
 * `authentication.withCurrent`. Every database step runs in the Kit transaction under the
 * account lock; the password hash runs between two such transactions, never inside one.
 */
export class PasswordConfirmations {
  readonly #kit: PasswordConfirmationsDependencies['kit']
  readonly #db: Database
  readonly #config: ResolvedPasswordConfirmationsConfig
  readonly #verify: PasswordConfirmationsDependencies['verifyPassword']
  readonly #now: () => number
  readonly #throttle?: Limiter

  constructor(deps: PasswordConfirmationsDependencies) {
    this.#kit = deps.kit
    this.#db = deps.db
    this.#config = deps.config
    this.#verify = deps.config.verifyPassword ?? deps.verifyPassword
    this.#now = deps.now ?? Date.now
    const throttle = deps.config.throttle
    if (throttle) {
      if (!deps.limiter) {
        throw new InvalidPasswordConfirmationsConfigException(
          'throttle needs @adonisjs/limiter; register its provider or set throttle: false'
        )
      }
      // No blockDuration here: the store would block again each time a throttled retry crosses the
      // limit, extending the block for as long as the user keeps trying. #countFailure is the only
      // place a block starts, after a wrong password.
      this.#throttle = deps.limiter.use({
        requests: throttle.requests,
        duration: throttle.duration,
      })
    }
  }

  /** How long a confirmation stays spendable after the password check, in milliseconds. */
  get windowMs() {
    return this.#config.windowMs
  }

  async #authorize(context: KitContext, request: ConfirmationRequest) {
    // Host policy sees only what the confirmation binds: never the password or the confirmation id.
    const { action, scope, intent } = request
    if ((await this.#config.authorize(context, { action, scope, intent })) !== true) {
      throw new PasswordConfirmationForbiddenException()
    }
  }

  /**
   * Three fixed-width keys per account, so a long string id cannot outgrow the limiter store's key
   * column. `attempts` counts reservations (checks in flight plus wrong passwords) and caps the
   * hashes a burst can run; `failed` counts completed wrong passwords only; `blocked` is the block
   * they arm. A refund touches `attempts` alone, so it can neither erase a failure nor open a block.
   */
  #throttleKeys(userId: UserId) {
    const account = createHash('sha256').update(String(userId)).digest('hex')
    const attempts = `password_confirmations:${account}`
    return { attempts, failed: `${attempts}:failed`, blocked: `${attempts}:blocked` }
  }

  /** Account Kit's login pattern: consume first, refuse when the budget is gone. */
  async #reserveAttempt(keys: { attempts: string; blocked: string }) {
    const block = await this.#throttle!.get(keys.blocked)
    if (block && block.consumed > 0) {
      throw new PasswordConfirmationThrottledException(block.availableIn)
    }
    const key = keys.attempts
    try {
      await this.#throttle!.consume(key)
    } catch (error) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        if (error.response.consumed > error.response.limit) await this.#throttle!.decrement(key)
        throw new PasswordConfirmationThrottledException(error.response.availableIn)
      }
      throw error
    }
  }

  /**
   * Counts a completed wrong password and blocks for `blockDuration` once `requests` of them have
   * completed. Checks still in flight are not failures: they do not arm the block. The block has
   * its own key, so a throttled retry never extends it.
   */
  async #countFailure(keys: { attempts: string; failed: string; blocked: string }) {
    const throttle = this.#config.throttle
    const failed = await this.#throttle!.increment(keys.failed)
    if (throttle && failed.consumed >= throttle.requests) {
      await this.#throttle!.set(keys.blocked, 1, throttle.blockDuration)
      // From here the block alone decides, for exactly blockDuration. Left in place, a spent
      // budget would keep refusing after a block shorter than the counting window had lapsed.
      await Promise.all([
        this.#throttle!.delete(keys.attempts),
        this.#throttle!.delete(keys.failed),
      ])
    }
  }

  #signInId(context: KitContext) {
    if (context.signInId === undefined) throw new SessionRegistryRequiredException()
    return context.signInId
  }

  async #passwordHash(userId: UserId, trx: Trx) {
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
   */
  async confirmPassword(
    input: CurrentAccountInput,
    request: ConfirmPasswordRequest
  ): Promise<IssuedConfirmation> {
    // The Kit reads these fields on every call. A host that refreshes its credential object in
    // place must not move stage two onto another sign-in than the one whose hash was checked.
    const current = { ...input }
    const binding = bindRequest(request)
    const first = await this.#kit.authentication.withCurrent(current, async (context) => {
      this.#signInId(context)
      await this.#authorize(context, request)
      return {
        userId: context.account.id,
        // An account the Kit reports as passwordless cannot confirm with one, whatever is stored:
        // Account Kit's login refuses it too. A null hash is a wrong password and counts as one.
        hash: context.account.hasPassword
          ? await this.#passwordHash(context.account.id, context.trx)
          : null,
      }
    })
    // Reserve an attempt atomically before the hash, so a parallel burst cannot run more hashes than
    // the budget (penalize checks then increments, which a burst races through).
    const throttleKeys = this.#throttleKeys(first.userId)
    if (this.#throttle) await this.#reserveAttempt(throttleKeys)
    let ok: boolean
    try {
      ok =
        typeof request.password === 'string' &&
        first.hash !== null &&
        (await this.#verify(first.hash, request.password))
    } catch (error) {
      // An infrastructure fault is not a wrong guess: give the attempt back. If the refund fails
      // too, report both; whether the attempt is still charged is then unknown.
      try {
        if (this.#throttle) await this.#throttle.decrement(throttleKeys.attempts)
      } catch (refundError) {
        throw new AggregateError(
          [error, refundError],
          'Password verification failed and its throttle attempt could not be refunded',
          { cause: error }
        )
      }
      throw error
    }
    if (!ok) {
      if (this.#throttle) await this.#countFailure(throttleKeys)
      throw new PasswordConfirmationDeniedException()
    }
    // The window runs from the check itself, not from the limiter reset that follows it.
    const verifiedAt = this.#now()
    if (this.#throttle) {
      // A correct password resets the budget. No block can exist here: arming one takes `requests`
      // completed failures, and this check held one of the `requests` slots.
      await Promise.all([
        this.#throttle.delete(throttleKeys.attempts),
        this.#throttle.delete(throttleKeys.failed),
      ])
    }

    return this.#kit.authentication.withCurrent(current, async (context) => {
      if (context.account.id !== first.userId) throw new PasswordConfirmationRequiredException()
      const signInId = this.#signInId(context)
      await this.#authorize(context, request)
      const issuedAt = this.#now()
      // The deadline is stored, so a later change to `window` cannot move it for this confirmation.
      const expiresAt = verifiedAt + this.#config.windowMs
      // Same input, so withCurrent has re-checked this sign-in and its credential revision.
      if (issuedAt >= expiresAt) throw new PasswordConfirmationStaleException()
      const revision = await liveCredentialRevision(
        context.trx,
        this.#config.usersTable,
        context.account.id
      )
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
   * caller passes besides the confirmation and request can widen what it authorizes. The spend rolls back
   * with the caller's transaction.
   */
  async consume(context: KitContext, request: ConsumeRequest) {
    const signInId = this.#signInId(context)
    const binding = bindRequest(request)
    await this.#authorize(context, request)
    if (typeof request.confirmationId !== 'string' || request.confirmationId === '') {
      throw new PasswordConfirmationRequiredException()
    }
    const now = this.#now()
    const revision = await liveCredentialRevision(
      context.trx,
      this.#config.usersTable,
      context.account.id
    )
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
    if (affected(await query.update({ consumed_at: now })) !== 1) {
      throw new PasswordConfirmationRequiredException()
    }
  }

  /** `withCurrent` + `consume` + `run` in one Kit transaction. Prefer this over `consume`. */
  withConfirmation<T>(
    input: CurrentAccountInput,
    request: ConsumeRequest,
    run: (context: KitContext) => Promise<T>
  ): Promise<T> {
    return this.#kit.authentication.withCurrent(input, async (context) => {
      await this.consume(context, request)
      return run(context)
    })
  }

  /** Deletes spent and expired confirmations. Schedule it; returns the number of rows removed. */
  async prune() {
    return affected(
      await this.#db
        .from(this.#config.table)
        .where('expires_at', '<=', this.#now())
        .orWhereNotNull('consumed_at')
        .delete()
    )
  }
}
