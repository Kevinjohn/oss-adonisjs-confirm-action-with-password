/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { PasswordConfirmationAuthorization } from '../src/authorization.ts'
import { InvalidArgumentsException, RuntimeException } from '@adonisjs/core/exceptions'
import type { Fixture } from './helpers.ts'
import { bootFixture, readCallResult } from './helpers.ts'
import { defineConfig } from '../src/define_config.ts'
import type { PasswordConfirmationsConfig } from '../src/types.ts'

const PW = 'pw-one-Original-7'
const request = { operation: 'transfer-ownership', scope: 'company-1', intent: {} }

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
  const service = await fixture.app.container.make('password_confirmations.manager')
  return readCallResult(service.confirmPassword(input, { ...request, password: PW }))
}

test.group('PasswordConfirmationAuthorization', () => {
  test('a registered authorize reaches the service; registering after resolution throws', async ({
    assert,
  }) => {
    const fixture = await bootWith()
    try {
      const authorization = await fixture.app.container.make(PasswordConfirmationAuthorization)
      const seen: unknown[] = []
      let loads = 0
      authorization.register(async () => {
        loads++
        return async (_context, confirmation) => {
          seen.push(confirmation.operation)
          return false
        }
      })
      assert.equal(loads, 0)
      assert.strictEqual(
        await fixture.app.container.make(PasswordConfirmationAuthorization),
        authorization
      )
      assert.equal(await confirmThroughService(fixture), 'E_PASSWORD_CONFIRMATION_FORBIDDEN')
      await fixture.app.container.make('password_confirmations.manager')
      assert.deepEqual(seen, ['transfer-ownership'])
      assert.equal(loads, 1)
      assert.throws(
        () => authorization.register(() => undefined),
        RuntimeException,
        /authorize must be registered before PasswordConfirmations is first resolved/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a second registration throws', async ({ assert }) => {
    const fixture = await bootWith()
    try {
      const authorization = await fixture.app.container.make(PasswordConfirmationAuthorization)
      authorization.register(() => undefined)
      assert.throws(
        () => authorization.register(() => undefined),
        RuntimeException,
        /authorize is already registered/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('authorize in both the config and the loader throws naming it', async ({ assert }) => {
    const fixture = await bootWith({ authorize: async () => true })
    try {
      const authorization = await fixture.app.container.make(PasswordConfirmationAuthorization)
      authorization.register(() => async () => true)
      await assert.rejects(
        () => fixture.app.container.make('password_confirmations.manager'),
        /Invalid config\/password_confirmations.ts: authorize is set in both/
      )
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a registered authorize that is not a function is refused', async ({ assert }) => {
    const fixture = await bootWith()
    try {
      const authorization = await fixture.app.container.make(PasswordConfirmationAuthorization)
      authorization.register(() => true as never)
      await assert.rejects(
        () => fixture.app.container.make('password_confirmations.manager'),
        InvalidArgumentsException,
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
