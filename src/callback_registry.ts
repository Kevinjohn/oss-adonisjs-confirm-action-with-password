/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { InvalidPasswordConfirmationsConfigException } from './errors.js'
import type { PasswordConfirmationCallbacks } from './types.js'

type CallbacksFactory = () => PasswordConfirmationCallbacks | Promise<PasswordConfirmationCallbacks>

/**
 * Callbacks the application supplies from its own provider's `boot()` instead of the config file
 * (container alias `password_confirmations.callbacks`). The factory runs once, when
 * `PasswordConfirmations` is first resolved.
 */
export class PasswordConfirmationCallbackRegistry {
  #factory?: CallbacksFactory
  #resolved?: Promise<PasswordConfirmationCallbacks | undefined>

  register(factory: CallbacksFactory): void {
    if (this.#resolved) {
      throw new InvalidPasswordConfirmationsConfigException(
        'callbacks must be registered before PasswordConfirmations is first resolved'
      )
    }
    if (this.#factory) {
      throw new InvalidPasswordConfirmationsConfigException('callbacks are already registered')
    }
    this.#factory = factory
  }

  /** @internal Runs the factory once; `undefined` when nothing was registered. */
  resolve(): Promise<PasswordConfirmationCallbacks | undefined> {
    this.#resolved ??= (async () => this.#factory?.())()
    return this.#resolved
  }
}
