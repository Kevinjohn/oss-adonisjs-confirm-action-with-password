/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

export * as errors from './src/errors.ts'

export { configure } from './configure.ts'
export { stubsRoot } from './stubs/main.ts'
export { defineConfig } from './src/define_config.ts'
export { PasswordConfirmations } from './src/password_confirmations.ts'
export { PasswordConfirmationAuthorization } from './src/authorization.ts'
export {
  PasswordConfirmationRequiredException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  InvalidPasswordConfirmationRequestException,
  SessionRegistryRequiredException,
  E_PASSWORD_CONFIRMATION_REQUIRED,
  E_PASSWORD_CONFIRMATION_DENIED,
  E_PASSWORD_CONFIRMATION_THROTTLED,
  E_PASSWORD_CONFIRMATION_STALE,
  E_PASSWORD_CONFIRMATION_FORBIDDEN,
  E_PASSWORD_CONFIRMATION_INVALID_REQUEST,
  E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
} from './src/errors.ts'
export type * from './src/types.ts'
