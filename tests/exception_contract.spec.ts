import { test } from '@japa/runner'
import { errors } from '../index.js'

test('exported exception constructors reject code and status options', ({
  assert,
  expectTypeOf,
}) => {
  const fixed = [
    errors.E_PASSWORD_CONFIRMATION_REQUIRED,
    errors.E_PASSWORD_CONFIRMATION_ACCOUNT_CHANGED,
    errors.E_PASSWORD_CONFIRMATION_BINDING_REJECTED,
    errors.E_PASSWORD_CONFIRMATION_INTENT_DEPTH,
    errors.E_PASSWORD_CONFIRMATION_INTENT_NON_FINITE,
    errors.E_PASSWORD_CONFIRMATION_INTENT_UNSAFE_INTEGER,
    errors.E_PASSWORD_CONFIRMATION_INTENT_VALUE,
    errors.E_PASSWORD_CONFIRMATION_INTENT_REQUIRED,
    errors.E_PASSWORD_CONFIRMATION_INVALID_THROTTLE,
    errors.E_PASSWORD_CONFIRMATION_INVALID_BUDGET,
    errors.E_PASSWORD_CONFIRMATION_CALLBACKS_RESOLVED,
    errors.E_PASSWORD_CONFIRMATION_CALLBACKS_REGISTERED,
    errors.E_PASSWORD_CONFIRMATION_LIMITER_REQUIRED,
    errors.E_PASSWORD_CONFIRMATION_CONFIG_REQUIRED,
    errors.E_PASSWORD_CONFIRMATION_CALLBACK_CONFLICT,
    errors.E_PASSWORD_CONFIRMATION_PASSWORD_UNAVAILABLE,
    errors.E_PASSWORD_CONFIRMATION_PASSWORD_HASH_MISSING,
    errors.E_PASSWORD_CONFIRMATION_PASSWORD_INPUT_INVALID,
    errors.E_PASSWORD_CONFIRMATION_DENIED,
    errors.E_PASSWORD_CONFIRMATION_STALE,
    errors.E_PASSWORD_CONFIRMATION_FORBIDDEN,
    errors.E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED,
  ] as const
  for (const Exception of fixed) {
    const error = new Exception()
    assert.equal(error.code, Exception.code)
    assert.equal(error.status, Exception.status)
    expectTypeOf<ConstructorParameters<typeof Exception>>().toEqualTypeOf<[]>()
  }
  expectTypeOf<
    ConstructorParameters<typeof errors.E_PASSWORD_CONFIRMATION_THROTTLED>
  >().toEqualTypeOf<[retryAfterSeconds: number]>()
  expectTypeOf<
    ConstructorParameters<typeof errors.E_PASSWORD_CONFIRMATION_INVALID_REQUEST>
  >().toEqualTypeOf<[reason: string]>()
  expectTypeOf<
    ConstructorParameters<typeof errors.E_PASSWORD_CONFIRMATION_INVALID_CONFIG>
  >().toEqualTypeOf<[reason: string]>()
})
