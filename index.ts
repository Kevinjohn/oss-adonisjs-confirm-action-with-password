/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

export * as errors from './src/errors.js'

export { configure, stubsRoot } from './configure.js'
export { defineConfig } from './src/define_config.js'
export { PasswordConfirmations } from './src/password_confirmations.js'
export { PasswordConfirmationCallbackRegistry } from './src/callback_registry.js'
export type { PasswordConfirmationsDependencies } from './src/password_confirmations.js'
export {
  PasswordConfirmationAccountChangedException,
  E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED,
  PasswordConfirmationBindingRejectedException,
  E_PASSWORD_CONFIRMATION_BINDING_REJECTED,
  PasswordConfirmationIntentDepthException,
  E_PASSWORD_CONFIRMATION_INTENT_DEPTH,
  PasswordConfirmationNonFiniteIntentException,
  E_PASSWORD_CONFIRMATION_INTENT_NON_FINITE,
  PasswordConfirmationUnsafeIntegerException,
  E_PASSWORD_CONFIRMATION_INTENT_UNSAFE_INTEGER,
  PasswordConfirmationIntentValueException,
  E_PASSWORD_CONFIRMATION_INTENT_VALUE,
  PasswordConfirmationIntentRequiredException,
  E_PASSWORD_CONFIRMATION_INTENT_REQUIRED,
  PasswordConfirmationInvalidDurationException,
  E_PASSWORD_CONFIRMATION_INVALID_DURATION,
  PasswordConfirmationInvalidThrottleException,
  E_PASSWORD_CONFIRMATION_INVALID_THROTTLE,
  PasswordConfirmationInvalidBudgetException,
  E_PASSWORD_CONFIRMATION_INVALID_BUDGET,
  PasswordConfirmationInvalidTableException,
  E_PASSWORD_CONFIRMATION_INVALID_TABLE,
  PasswordConfirmationInvalidCallbackException,
  E_PASSWORD_CONFIRMATION_INVALID_CALLBACK,
  PasswordConfirmationCallbacksResolvedException,
  E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED,
  PasswordConfirmationCallbacksRegisteredException,
  E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED,
  PasswordConfirmationLimiterRequiredException,
  E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED,
  PasswordConfirmationConfigRequiredException,
  E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED,
  PasswordConfirmationCallbackConflictException,
  E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT,
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
