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

test.group('defineConfig', () => {
  test('defaults to a five-minute window and the standard tables', async ({ assert }) => {
    const config = defineConfig()
    assert.equal(config.windowMs, 5 * 60_000)
    assert.equal(config.table, 'password_confirmations')
    assert.equal(config.usersTable, 'users')
    assert.isTrue(await config.authorize({} as never, {} as never))
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
})
