/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { PasswordConfirmations } from '../src/password_confirmations.js'
import { PasswordConfirmationCallbackRegistry } from '../src/callback_registry.js'
import {
  E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED,
  E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT,
  E_PASSWORD_CONFIRMATION_INVALID_CALLBACK,
} from '../src/errors.js'
import type { ResolvedPasswordConfirmationsConfig } from '../src/types.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'password_confirmations': PasswordConfirmations
    'password_confirmations.callbacks': PasswordConfirmationCallbackRegistry
  }
}

/**
 * Registers `PasswordConfirmations` (alias `password_confirmations`) built from
 * `config/password_confirmations.ts` and the callbacks registered through
 * `PasswordConfirmationCallbackRegistry` (alias `password_confirmations.callbacks`).
 */
export default class PasswordConfirmationsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const callbackRegistry = new PasswordConfirmationCallbackRegistry()
    this.app.container.singleton(PasswordConfirmationCallbackRegistry, () => callbackRegistry)
    this.app.container.alias(
      'password_confirmations.callbacks',
      PasswordConfirmationCallbackRegistry
    )
    this.app.container.singleton(PasswordConfirmations, async (resolver) => {
      const config = this.app.config.get<ResolvedPasswordConfirmationsConfig | undefined>(
        'password_confirmations'
      )
      if (!config?.windowMs) {
        throw new E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED('export default defineConfig({...})')
      }
      const callbacks = await callbackRegistry.resolve()
      const authorize = callbacks?.authorize ?? undefined
      if (authorize !== undefined) {
        if (config.authorize) {
          throw new E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT(
            'authorize is set in both the config and password_confirmations.callbacks'
          )
        }
        if (typeof authorize !== 'function') {
          throw new E_PASSWORD_CONFIRMATION_INVALID_CALLBACK('authorize must be a function')
        }
      }
      const hash = await resolver.make('hash')
      // Without the limiter provider, let the constructor explain the throttle requirement.
      const limiter =
        config.throttle && this.app.container.hasBinding('limiter.manager')
          ? await resolver.make('limiter.manager')
          : undefined
      return new PasswordConfirmations({
        limiter,
        kit: await resolver.make(AccountKit),
        db: await resolver.make('lucid.db'),
        config: { ...config, authorize: config.authorize ?? authorize },
        verifyPassword: (hashed, password) => hash.verify(hashed, password),
      })
    })
    this.app.container.alias('password_confirmations', PasswordConfirmations)
  }
}
