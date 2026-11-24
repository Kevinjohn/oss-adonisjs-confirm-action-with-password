import { test } from '@japa/runner'
import { errors } from '../index.js'

test('exported exception constructors reject code and status options', ({
  assert,
  expectTypeOf,
}) => {
  const fixed = [
    errors.E_PASSWORD_CONFIRMATION_REQUIRED,
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
