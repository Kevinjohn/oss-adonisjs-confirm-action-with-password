/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { Exception } from '@adonisjs/core/exceptions'

/** The request supplies no confirmation identifier. */
export class PasswordConfirmationRequiredException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_REQUIRED'
  static status = 403
  static message = 'Confirm this action again.'

  constructor() {
    super()
  }
}

/** The password did not match. It already counts against the built-in per-account throttle. */
export class PasswordConfirmationDeniedException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_DENIED'
  static status = 403
  static message = 'Incorrect password.'

  constructor() {
    super()
  }
}

/** Too many wrong passwords for this account; retry after `retryAfterSeconds`. */
export class PasswordConfirmationThrottledException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_THROTTLED'
  static status = 429
  static message = 'Too many attempts. Try again later.'
  constructor(readonly retryAfterSeconds: number) {
    super()
  }
}

/** The window passed between the password check and issue. */
export class PasswordConfirmationStaleException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_STALE'
  static status = 403
  static message = 'Confirm this action again.'

  constructor() {
    super()
  }
}

/** The host authorisation callback (`authorize`) refused the operation. */
export class PasswordConfirmationForbiddenException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_FORBIDDEN'
  static status = 403
  static message = 'This action is not allowed.'

  constructor() {
    super()
  }
}

/** `action`, `scope` or `intent` is malformed. */
export class InvalidPasswordConfirmationRequestException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_REQUEST'
  static status = 400
  constructor(reason: string) {
    super(`Invalid password confirmation request: ${reason}`)
  }
}

/**
 * Account Kit gave no sign-in id: confirmations need the session strategy with `sessionManagement`
 * enabled, because they bind to the sign-in registry row.
 */
export class SessionRegistryRequiredException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED'
  static status = 500
  static message =
    'Password confirmations need Account Kit session login with sessionManagement enabled (no signInId).'

  constructor() {
    super()
  }
}

/** `config/password_confirmations.ts` is missing or invalid. */
export class InvalidPasswordConfirmationsConfigException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_CONFIG'
  static status = 500
  constructor(reason: string) {
    super(`Invalid config/password_confirmations.ts: ${reason}`)
  }
}

export const E_PASSWORD_CONFIRMATION_REQUIRED = PasswordConfirmationRequiredException
export const E_PASSWORD_CONFIRMATION_DENIED = PasswordConfirmationDeniedException
export const E_PASSWORD_CONFIRMATION_THROTTLED = PasswordConfirmationThrottledException
export const E_PASSWORD_CONFIRMATION_STALE = PasswordConfirmationStaleException
export const E_PASSWORD_CONFIRMATION_FORBIDDEN = PasswordConfirmationForbiddenException
export const E_PASSWORD_CONFIRMATION_INVALID_REQUEST = InvalidPasswordConfirmationRequestException
export const E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED = SessionRegistryRequiredException
export const E_PASSWORD_CONFIRMATION_INVALID_CONFIG = InvalidPasswordConfirmationsConfigException

/** The account changed between password verification and issuance. */
export class PasswordConfirmationAccountChangedException extends PasswordConfirmationRequiredException {
  static code = 'E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED'
  static status = 403
}

export const E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED = PasswordConfirmationAccountChangedException

/** No spendable confirmation matches this account, sign-in, credential and request. */
export class PasswordConfirmationBindingRejectedException extends PasswordConfirmationRequiredException {
  static code = 'E_PASSWORD_CONFIRMATION_BINDING_REJECTED'
  static status = 403
}

export const E_PASSWORD_CONFIRMATION_BINDING_REJECTED = PasswordConfirmationBindingRejectedException

/** The intent exceeds the supported nesting depth. */
export class PasswordConfirmationIntentDepthException extends InvalidPasswordConfirmationRequestException {
  static code = 'E_PASSWORD_CONFIRMATION_INTENT_DEPTH'
  static status = 400
}

export const E_PASSWORD_CONFIRMATION_INTENT_DEPTH = PasswordConfirmationIntentDepthException

/** The intent contains a non-finite number. */
export class PasswordConfirmationNonFiniteIntentException extends InvalidPasswordConfirmationRequestException {
  static code = 'E_PASSWORD_CONFIRMATION_INTENT_NON_FINITE'
  static status = 400
}

export const E_PASSWORD_CONFIRMATION_INTENT_NON_FINITE =
  PasswordConfirmationNonFiniteIntentException

/** The intent contains an integer that has lost precision. */
export class PasswordConfirmationUnsafeIntegerException extends InvalidPasswordConfirmationRequestException {
  static code = 'E_PASSWORD_CONFIRMATION_INTENT_UNSAFE_INTEGER'
  static status = 400
}

export const E_PASSWORD_CONFIRMATION_INTENT_UNSAFE_INTEGER =
  PasswordConfirmationUnsafeIntegerException

/** The intent contains a value outside plain JSON. */
export class PasswordConfirmationIntentValueException extends InvalidPasswordConfirmationRequestException {
  static code = 'E_PASSWORD_CONFIRMATION_INTENT_VALUE'
  static status = 400
}

export const E_PASSWORD_CONFIRMATION_INTENT_VALUE = PasswordConfirmationIntentValueException

/** The request has no intent. */
export class PasswordConfirmationIntentRequiredException extends InvalidPasswordConfirmationRequestException {
  static code = 'E_PASSWORD_CONFIRMATION_INTENT_REQUIRED'
  static status = 400
}

export const E_PASSWORD_CONFIRMATION_INTENT_REQUIRED = PasswordConfirmationIntentRequiredException

/** A configured duration cannot be parsed or is outside its supported range. */
export class PasswordConfirmationInvalidDurationException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_DURATION'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_INVALID_DURATION = PasswordConfirmationInvalidDurationException

/** The throttle configuration is not an object or false. */
export class PasswordConfirmationInvalidThrottleException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_THROTTLE'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_INVALID_THROTTLE = PasswordConfirmationInvalidThrottleException

/** The throttle request budget is not a positive integer. */
export class PasswordConfirmationInvalidBudgetException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_BUDGET'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_INVALID_BUDGET = PasswordConfirmationInvalidBudgetException

/** A configured table name is not a plain SQL identifier. */
export class PasswordConfirmationInvalidTableException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_TABLE'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_INVALID_TABLE = PasswordConfirmationInvalidTableException

/** A configured callback is not a function. */
export class PasswordConfirmationInvalidCallbackException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_CALLBACK'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_INVALID_CALLBACK = PasswordConfirmationInvalidCallbackException

/** Callbacks are registered after the service was resolved. */
export class PasswordConfirmationCallbacksResolvedException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED =
  PasswordConfirmationCallbacksResolvedException

/** A callback factory was already registered. */
export class PasswordConfirmationCallbacksRegisteredException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED =
  PasswordConfirmationCallbacksRegisteredException

/** Throttling is enabled without a limiter provider. */
export class PasswordConfirmationLimiterRequiredException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED = PasswordConfirmationLimiterRequiredException

/** The confirmation provider has no resolved configuration. */
export class PasswordConfirmationConfigRequiredException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED = PasswordConfirmationConfigRequiredException

/** Authorization is configured through both callback sources. */
export class PasswordConfirmationCallbackConflictException extends InvalidPasswordConfirmationsConfigException {
  static code = 'E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT'
  static status = 500
}

export const E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT =
  PasswordConfirmationCallbackConflictException
