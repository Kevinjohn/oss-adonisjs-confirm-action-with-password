/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import {
  E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED,
  E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED,
} from './errors.js'
import type { PasswordConfirmationCallbacks } from './types.js'

type CallbacksFactory = () => PasswordConfirmationCallbacks | Promise<PasswordConfirmationCallbacks>

/**
 * Callbacks the application supplies from its own provider's `boot()` instead of the config file
 * (container alias `password_confirmations.callbacks`). The factory runs once, when
 * `PasswordConfirmations` is first resolved.
 *
 * @example
 * ```ts
 * import { PasswordConfirmationCallbackRegistry } from '@kevinjohn/adonisjs-confirm-action-with-password'
 * import type { ApplicationService } from '@adonisjs/core/types'
 *
 * export default class CompanyCallbacksProvider {
 *   constructor(protected app: ApplicationService) {}
 *
 *   async boot() {
 *     const callbacks = await this.app.container.make(PasswordConfirmationCallbackRegistry)
 *     callbacks.register(() => ({
 *       authorize: async ({ account, trx }, { scope }) => {
 *         const company = await trx
 *           .from('companies')
 *           .where({ id: scope, owner_id: account.id })
 *           .first()
 *         return Boolean(company)
 *       },
 *     }))
 *   }
 * }
 * ```
 */
export class PasswordConfirmationCallbackRegistry {
  #factory?: CallbacksFactory
  #resolved?: Promise<PasswordConfirmationCallbacks | undefined>

  /**
   * Registers a callback factory before the confirmation service is first resolved.
   *
   * @example
   * ```ts
   * callbacks.register(() => ({
   *   authorize: async ({ account, trx }, { scope }) =>
   *     Boolean(await trx.from('companies').where({ id: scope, owner_id: account.id }).first()),
   * }))
   * ```
   */
  register(factory: CallbacksFactory): void {
    if (this.#resolved) {
      throw new E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED()
    }
    if (this.#factory) {
      throw new E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED()
    }
    this.#factory = factory
  }

  /**
   * Runs the factory once and returns its callbacks, or `undefined` when no factory is registered.
   *
   * @example
   * ```ts
   * const registeredCallbacks = await callbacks.resolve()
   * ```
   * @internal
   */
  resolve(): Promise<PasswordConfirmationCallbacks | undefined> {
    this.#resolved ??= (async () => this.#factory?.())()
    return this.#resolved
  }
}
