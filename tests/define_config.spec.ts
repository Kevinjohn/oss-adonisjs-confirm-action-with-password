/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
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
})
