/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { Exception } from '@adonisjs/core/exceptions'

/** The confirmation is missing, spent, expired, or bound to another session, credential or request. */
export class PasswordConfirmationRequiredException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_REQUIRED'
  static status = 403
  constructor() {
    super('Confirm this action again.', {
      code: PasswordConfirmationRequiredException.code,
      status: PasswordConfirmationRequiredException.status,
    })
  }
}

/** The password did not match. It already counts against the built-in per-account throttle. */
export class PasswordConfirmationDeniedException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_DENIED'
  static status = 403
  constructor() {
    super('Incorrect password.', {
      code: PasswordConfirmationDeniedException.code,
      status: PasswordConfirmationDeniedException.status,
    })
  }
}

/** Too many wrong passwords for this account; retry after `retryAfterSeconds`. */
export class PasswordConfirmationThrottledException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_THROTTLED'
  static status = 429
  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts. Try again later.', {
      code: PasswordConfirmationThrottledException.code,
      status: PasswordConfirmationThrottledException.status,
    })
  }
}

/** The window passed between the password check and issue. */
export class PasswordConfirmationStaleException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_STALE'
  static status = 403
  constructor() {
    super('Confirm this action again.', {
      code: PasswordConfirmationStaleException.code,
      status: PasswordConfirmationStaleException.status,
    })
  }
}

/** Host policy (`authorize`) refused the action. */
export class PasswordConfirmationForbiddenException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_FORBIDDEN'
  static status = 403
  constructor() {
    super('This action is not allowed.', {
      code: PasswordConfirmationForbiddenException.code,
      status: PasswordConfirmationForbiddenException.status,
    })
  }
}

/** `action`, `scope` or `intent` is malformed. */
export class InvalidPasswordConfirmationRequestException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_REQUEST'
  static status = 400
  constructor(reason: string) {
    super(`Invalid password confirmation request: ${reason}`, {
      code: InvalidPasswordConfirmationRequestException.code,
      status: InvalidPasswordConfirmationRequestException.status,
    })
  }
}

/**
 * Account Kit gave no sign-in id: confirmations need the session strategy with `sessionManagement`
 * enabled, because they bind to the sign-in registry row.
 */
export class SessionRegistryRequiredException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED'
  static status = 500
  constructor() {
    super(
      'Password confirmations need Account Kit session login with sessionManagement enabled (no signInId).',
      {
        code: SessionRegistryRequiredException.code,
        status: SessionRegistryRequiredException.status,
      }
    )
  }
}

/** `config/password_confirmations.ts` is missing or invalid. */
export class InvalidPasswordConfirmationsConfigException extends Exception {
  static code = 'E_PASSWORD_CONFIRMATION_INVALID_CONFIG'
  static status = 500
  constructor(reason: string) {
    super(`Invalid config/password_confirmations.ts: ${reason}`, {
      code: InvalidPasswordConfirmationsConfigException.code,
      status: InvalidPasswordConfirmationsConfigException.status,
    })
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
