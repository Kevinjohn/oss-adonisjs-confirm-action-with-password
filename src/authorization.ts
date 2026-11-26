/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { InvalidArgumentsException, RuntimeException } from '@adonisjs/core/exceptions'
import type { AuthorizeConfirmation, LoadConfirmationAuthorization } from './types.ts'

/**
 * Loads an authorization callback from a host provider when PasswordConfirmations first resolves.
 *
 * @example
 * ```ts
 * import { PasswordConfirmationAuthorization } from '@kevinjohn/adonisjs-confirm-action-with-password'
 * import type { ApplicationService } from '@adonisjs/core/types'
 *
 * export default class CompanyAuthorizationProvider {
 *   constructor(protected app: ApplicationService) {}
 *
 *   async boot() {
 *     const authorization = await this.app.container.make(PasswordConfirmationAuthorization)
 *     authorization.register(async () => {
 *       const { authorizePasswordConfirmation } = await import('#services/company_authorization')
 *       return authorizePasswordConfirmation
 *     })
 *   }
 * }
 * ```
 */
export class PasswordConfirmationAuthorization {
  #load?: LoadConfirmationAuthorization
  #resolved?: Promise<AuthorizeConfirmation | undefined>

  /**
   * Registers a loader before the confirmation service is first resolved.
   *
   * @throws {RuntimeException} A loader was already registered or resolution has started.
   * @example
   * ```ts
   * authorization.register(() => async ({ account, trx }, { scope }) =>
   *   Boolean(await trx.from('companies').where({ id: scope, owner_id: account.id }).first())
   * )
   * ```
   */
  register(load: LoadConfirmationAuthorization): void {
    if (this.#resolved) {
      throw new RuntimeException(
        'Password confirmation authorize must be registered before PasswordConfirmations is first resolved'
      )
    }
    if (this.#load) {
      throw new RuntimeException('Password confirmation authorize is already registered')
    }
    this.#load = load
  }

  /** @internal */
  resolve(): Promise<AuthorizeConfirmation | undefined> {
    this.#resolved ??= Promise.resolve().then(async () => {
      const authorize = (await this.#load?.()) ?? undefined
      if (authorize !== undefined && typeof authorize !== 'function') {
        throw new InvalidArgumentsException('Password confirmation authorize must be a function')
      }
      return authorize
    })
    return this.#resolved
  }
}
