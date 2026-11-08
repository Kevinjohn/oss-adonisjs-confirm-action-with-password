/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { AccountKit } from '@kevinjohn/adonisjs-account-kit'
import { PasswordConfirmations } from '../src/password_confirmations.js'
import { InvalidPasswordConfirmationsConfigException } from '../src/errors.js'
import type { ResolvedPasswordConfirmationsConfig } from '../src/types.js'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    password_confirmations: PasswordConfirmations
  }
}

/** Registers `PasswordConfirmations` (alias `password_confirmations`) built from `config/password_confirmations.ts`. */
export default class PasswordConfirmationsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(PasswordConfirmations, async (resolver) => {
      const config = this.app.config.get<ResolvedPasswordConfirmationsConfig | undefined>(
        'password_confirmations'
      )
      if (!config?.windowMs) {
        throw new InvalidPasswordConfirmationsConfigException('export default defineConfig({...})')
      }
      const hash = await resolver.make('hash')
      const limiter = config.throttle ? await resolver.make('limiter.manager') : undefined
      return new PasswordConfirmations({
        limiter,
        kit: await resolver.make(AccountKit),
        db: await resolver.make('lucid.db'),
        config,
        verifyPassword: (hashed, password) => hash.verify(hashed, password),
      })
    })
    this.app.container.alias('password_confirmations', PasswordConfirmations)
  }
}
