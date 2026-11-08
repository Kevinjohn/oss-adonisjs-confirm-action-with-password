/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import app from '@adonisjs/core/services/app'
import type { PasswordConfirmations } from '../src/password_confirmations.js'

let passwordConfirmations: PasswordConfirmations

await app.booted(async () => {
  passwordConfirmations = await app.container.make('password_confirmations')
})

export { passwordConfirmations as default }
