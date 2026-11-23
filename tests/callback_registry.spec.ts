/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import type { Fixture } from './helpers.js'
import { bootFixture, readCallResult } from './helpers.js'
import { defineConfig } from '../src/define_config.js'
import type { PasswordConfirmationsConfig } from '../src/types.js'

const PW = 'pw-one-Original-7'
const request = { action: 'transfer-ownership', scope: 'company-1', intent: {} }

/** Boots an app with `config/password_confirmations.ts` set to `defineConfig(config)`. */
async function bootWith(config: PasswordConfirmationsConfig = {}) {
  const fixture = await bootFixture()
  fixture.app.config.set('password_confirmations', defineConfig(config))
  return fixture
}

/** Confirms the password for a new account through the container's service. */
async function confirmThroughService(fixture: Fixture) {
  const email = `user-${Math.random()}@x.test`
  await fixture.createUser(email, PW)
  const input = await fixture.login(email, PW)
  const service = await fixture.app.container.make('password_confirmations')
  return readCallResult(service.confirmPassword(input, { ...request, password: PW }))
}

test.group('password_confirmations.callbacks', () => {
  test('a registered authorize reaches the service; registering after resolution throws', async ({
    assert,
  }) => {
    const fixture = await bootWith()
    try {
      const registry = await fixture.app.container.make('password_confirmations.callbacks')
      const seen: unknown[] = []
      registry.register(async () => ({
        authorize: async (_context, confirmation) => {
          seen.push(confirmation.action)
          return false
        },
      }))
      assert.equal(await confirmThroughService(fixture), 'E_PASSWORD_CONFIRMATION_FORBIDDEN')
      assert.deepEqual(seen, ['transfer-ownership'])
      assert.throws(
        () => registry.register(() => ({})),
        /callbacks must be registered before PasswordConfirmations is first resolved/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a second registration throws', async ({ assert }) => {
    const fixture = await bootWith()
    try {
      const registry = await fixture.app.container.make('password_confirmations.callbacks')
      registry.register(() => ({}))
      assert.throws(() => registry.register(() => ({})), /callbacks are already registered/)
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('authorize in both the config and the registry throws naming it', async ({ assert }) => {
    const fixture = await bootWith({ authorize: async () => true })
    try {
      const registry = await fixture.app.container.make('password_confirmations.callbacks')
      registry.register(() => ({ authorize: async () => true }))
      await assert.rejects(
        () => fixture.app.container.make('password_confirmations'),
        /Invalid config\/password_confirmations.ts: authorize is set in both/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a registered authorize that is not a function is refused', async ({ assert }) => {
    const fixture = await bootWith()
    try {
      const registry = await fixture.app.container.make('password_confirmations.callbacks')
      registry.register(() => ({ authorize: true as never }))
      await assert.rejects(
        () => fixture.app.container.make('password_confirmations'),
        /authorize must be a function/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a config that passes authorize keeps working with nothing registered', async ({
    assert,
  }) => {
    const fixture = await bootWith({ authorize: async () => false })
    try {
      assert.equal(await confirmThroughService(fixture), 'E_PASSWORD_CONFIRMATION_FORBIDDEN')
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)
})
