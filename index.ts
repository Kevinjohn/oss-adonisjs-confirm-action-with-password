/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

export * as errors from './src/errors.js'

export { configure, stubsRoot } from './configure.js'
export { defineConfig } from './src/define_config.js'
export { PasswordConfirmations } from './src/password_confirmations.js'
export type { PasswordConfirmationsDependencies } from './src/password_confirmations.js'
export {
  PasswordConfirmationRequiredException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  InvalidPasswordConfirmationRequestException,
  SessionRegistryRequiredException,
  InvalidPasswordConfirmationsConfigException,
  E_PASSWORD_CONFIRMATION_REQUIRED,
  E_PASSWORD_CONFIRMATION_DENIED,
  E_PASSWORD_CONFIRMATION_THROTTLED,
  E_PASSWORD_CONFIRMATION_STALE,
  E_PASSWORD_CONFIRMATION_FORBIDDEN,
  E_PASSWORD_CONFIRMATION_INVALID_REQUEST,
  E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
  E_PASSWORD_CONFIRMATION_INVALID_CONFIG,
} from './src/errors.js'
export type * from './src/types.js'
