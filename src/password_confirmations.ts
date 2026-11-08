/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto'
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

/**
 * A confirmation issued with a null credential revision remains valid while the live revision is null.
 * A null revision never matches a non-null revision.
 */
const NULL_REVISION_MATCHES = true

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
      this.#throttle = deps.limiter.use(throttle)
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

  /** Account Kit's login pattern: consume first, refuse when the budget is gone. */
  async #reserveAttempt(key: string) {
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

  /** After a wrong password, block for `blockDuration` once the budget is used up. */
  async #blockWhenSpent(key: string) {
    const throttle = this.#config.throttle
    const response = await this.#throttle!.get(key)
    if (throttle && response && response.consumed >= response.limit) {
      await this.#throttle!.block(key, throttle.blockDuration)
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
    const binding = bindRequest(request)
    const first = await this.#kit.authentication.withCurrent(input, async (context) => {
      this.#signInId(context)
      await this.#authorize(context, request)
      return {
        userId: context.account.id,
        hash: await this.#passwordHash(context.account.id, context.trx),
      }
    })
    // Reserve an attempt atomically before the hash, so a parallel burst cannot run more hashes than
    // the budget (penalize checks then increments, which a burst races through).
    const throttleKey = `password_confirmations:${first.userId}`
    if (this.#throttle) await this.#reserveAttempt(throttleKey)
    let ok: boolean
    try {
      ok =
        typeof request.password === 'string' &&
        first.hash !== null &&
        (await this.#verify(first.hash, request.password))
    } catch (error) {
      // An infrastructure fault is not a wrong guess: give the attempt back.
      if (this.#throttle) await this.#throttle.decrement(throttleKey)
      throw error
    }
    if (!ok) {
      if (this.#throttle) await this.#blockWhenSpent(throttleKey)
      throw new PasswordConfirmationDeniedException()
    }
    if (this.#throttle) await this.#throttle.delete(throttleKey)
    const verifiedAt = this.#now()

    return this.#kit.authentication.withCurrent(input, async (context) => {
      const signInId = this.#signInId(context)
      await this.#authorize(context, request)
      const issuedAt = this.#now()
      // Same input, so withCurrent has re-checked this sign-in and its credential revision.
      if (issuedAt - verifiedAt >= this.#config.windowMs)
        throw new PasswordConfirmationStaleException()
      const revision = await liveCredentialRevision(
        context.trx,
        this.#config.usersTable,
        context.account.id
      )
      await context.trx
        .from(this.#config.table)
        .where('sign_in_id', signInId)
        .where((query) => {
          query
            .where('verified_at', '<=', issuedAt - this.#config.windowMs)
            .orWhereNotNull('consumed_at')
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
        consumed_at: null,
      })
      return { confirmationId, expiresAt: verifiedAt + this.#config.windowMs }
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
      .where('verified_at', '>', now - this.#config.windowMs)
    if (revision !== null) query.where('credential_revision', revision)
    else if (NULL_REVISION_MATCHES) query.whereNull('credential_revision')
    else throw new PasswordConfirmationRequiredException()
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
    const cutoff = this.#now() - this.#config.windowMs
    return affected(
      await this.#db
        .from(this.#config.table)
        .where('verified_at', '<=', cutoff)
        .orWhereNotNull('consumed_at')
        .delete()
    )
  }
}
