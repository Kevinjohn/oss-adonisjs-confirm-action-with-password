/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { RuntimeException } from '@adonisjs/core/exceptions'
import type { ApplicationService } from '@adonisjs/core/types'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { PasswordConfirmations } from '../src/password_confirmations.ts'
import { PasswordConfirmationAuthorization } from '../src/authorization.ts'
import type { ResolvedPasswordConfirmationsConfig } from '../src/types.ts'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    'password_confirmations.manager': PasswordConfirmations
  }
}

/** Registers the confirmation service and the authorization loader used by host providers. */
export default class PasswordConfirmationsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(
      PasswordConfirmationAuthorization,
      () => new PasswordConfirmationAuthorization()
    )
    this.app.container.singleton('password_confirmations.manager', async (resolver) => {
      const config = this.app.config.get<ResolvedPasswordConfirmationsConfig | undefined>(
        'password_confirmations'
      )
      if (!config?.windowMs) {
        throw new RuntimeException(
          'Invalid config/password_confirmations.ts: export default defineConfig({...})'
        )
      }
      const authorization = await resolver.make(PasswordConfirmationAuthorization)
      const authorize = await authorization.resolve()
      if (authorize !== undefined && config.authorize) {
        throw new RuntimeException(
          'Invalid config/password_confirmations.ts: authorize is set in both the config and PasswordConfirmationAuthorization'
        )
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
  }
}
