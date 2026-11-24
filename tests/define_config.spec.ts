/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { E_PASSWORD_CONFIRMATION_INVALID_CONFIG } from '../src/errors.js'

/** Runs `defineConfig` with a value its types forbid, as an untyped host config would. */
function defineUntyped(config: unknown) {
  return defineConfig(config as never)
}

/** The configuration exception `defineUntyped(config)` throws. */
function refusal(config: unknown) {
  try {
    defineUntyped(config)
  } catch (error) {
    if (error instanceof E_PASSWORD_CONFIRMATION_INVALID_CONFIG) return error
    throw error
  }
  throw new Error('defineConfig accepted the config')
}

test.group('defineConfig', () => {
  test('defaults to a five-minute window and the standard tables', async ({ assert }) => {
    const config = defineConfig()
    assert.equal(config.windowMs, 5 * 60_000)
    assert.equal(config.table, 'password_confirmations')
    assert.equal(config.usersTable, 'users')
    // Left unset so the provider can tell a configured authorize from a registered one.
    assert.isUndefined(config.authorize)
    assert.equal(defineConfig({ window: '90s' }).windowMs, 90_000)
    assert.equal(defineConfig({ window: 1000 }).windowMs, 1000)
    assert.deepEqual(config.throttle, {
      requests: 5,
      duration: '1 minute',
      blockDuration: '20 minutes',
    })
    assert.isFalse(defineConfig({ throttle: false }).throttle)
  })

  test('refuses an empty window and unsafe table names', ({ assert }) => {
    assert.throws(() => defineConfig({ window: 0 }), /window must be a positive duration/)
    assert.throws(() => defineConfig({ window: 'soon' }), /window must be a positive duration/)
    assert.throws(() => defineConfig({ table: 'confirmations; drop' }), /table must be/)
    assert.throws(() => defineConfig({ usersTable: '1users' }), /usersTable must be/)
    assert.throws(() => defineConfig({ throttle: { requests: 0 } }), /throttle.requests/)
  })

  test('refuses throttle durations the limiter cannot count', ({ assert }) => {
    // The limiter counts whole seconds: '1ms' parses to 0, which its memory store never expires.
    for (const duration of ['soon', 0, -1, 1.5, '1ms', Number.NaN, undefined]) {
      assert.throws(
        () => defineConfig({ throttle: { duration } }),
        /throttle\.duration must be a duration of at least one second/
      )
      assert.throws(
        () => defineConfig({ throttle: { blockDuration: duration } }),
        /throttle\.blockDuration must be a duration of at least one second/
      )
    }
    assert.deepEqual(defineConfig({ throttle: { duration: 30, blockDuration: '1s' } }).throttle, {
      requests: 5,
      duration: 30,
      blockDuration: '1s',
    })
  })

  test('accepts valid callbacks, throttle false and absent values as defaults', async ({
    assert,
  }) => {
    const authorize = async () => false
    const verifyPassword = async () => true
    const readPasswordHash = async () => null
    const config = defineConfig({ authorize, verifyPassword, readPasswordHash, throttle: false })
    assert.strictEqual(config.authorize, authorize)
    assert.strictEqual(config.verifyPassword, verifyPassword)
    assert.strictEqual(config.readPasswordHash, readPasswordHash)
    assert.isFalse(config.throttle)
    const absent = defineUntyped({
      window: null,
      table: null,
      usersTable: null,
      authorize: null,
      throttle: null,
    })
    assert.equal(absent.windowMs, 5 * 60_000)
    assert.equal(absent.table, 'password_confirmations')
    assert.isUndefined(absent.authorize)
    assert.deepEqual(absent.throttle, defineConfig().throttle)
  })

  test('refuses a config that is not an object', ({ assert }) => {
    assert.match(refusal(null).message, /the config must be an object/)
  })

  test('refuses table names that are not strings', ({ assert }) => {
    // An array holding a valid name would pass a coercing identifier check.
    assert.match(refusal({ table: ['password_confirmations'] }).message, /table must be a plain/)
    assert.match(refusal({ usersTable: ['users'] }).message, /usersTable must be a plain/)
  })

  test('refuses callbacks that are not functions', ({ assert }) => {
    assert.match(refusal({ authorize: true }).message, /authorize must be a function/)
    assert.match(refusal({ verifyPassword: 'bcrypt' }).message, /verifyPassword must be a function/)
    assert.match(refusal({ readPasswordHash: {} }).message, /readPasswordHash must be a function/)
  })

  test('refuses a throttle that is neither an object nor false', ({ assert }) => {
    for (const throttle of [true, 'off', 5, []]) {
      assert.match(refusal({ throttle }).message, /throttle must be an object or false/)
    }
  })

  test('refuses non-finite window and throttle durations without a parser cause', ({ assert }) => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const [config, reason] of [
        [{ window: duration }, /window must be a positive duration/],
        [
          { throttle: { duration } },
          /throttle\.duration must be a duration of at least one second/,
        ],
        [
          { throttle: { blockDuration: duration } },
          /throttle\.blockDuration must be a duration of at least one second/,
        ],
      ] as const) {
        const error = refusal(config)
        assert.match(error.message, reason)
        assert.isUndefined(error.cause)
      }
    }
  })

  test('keeps the duration parser error as the cause', ({ assert }) => {
    for (const [config, field] of [
      [{ window: 'soon' }, /window must be a positive duration/],
      [{ throttle: { duration: 'soon' } }, /throttle\.duration must be/],
      [{ throttle: { blockDuration: 'soon' } }, /throttle\.blockDuration must be/],
    ] as const) {
      const error = refusal(config)
      assert.match(error.message, field)
      assert.instanceOf(error.cause, Error)
      assert.match((error.cause as Error).message, /Invalid duration expression "soon"/)
    }
    // A parsed value below the minimum keeps the range error, with no parser cause.
    const tooShort = refusal({ throttle: { duration: '1ms' } })
    assert.match(tooShort.message, /throttle\.duration must be a duration of at least one second/)
    assert.isUndefined(tooShort.cause)
  })
})
