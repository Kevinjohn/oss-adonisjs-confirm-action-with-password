/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { PasswordConfirmations } from '../src/password_confirmations.ts'
import { defineConfig } from '../src/define_config.ts'
import { PasswordConfirmationAuthorization } from '../src/authorization.ts'
import PasswordConfirmationsProvider from '../providers/password_confirmations_provider.ts'
import { bootFixture } from './helpers.ts'

test.group('provider and service', () => {
  test('the container and services/main resolve one PasswordConfirmations from config', async ({
    assert,
  }) => {
    const fixture = await bootFixture()
    try {
      const fromContainer = await fixture.app.container.make('password_confirmations.manager')
      assert.instanceOf(fromContainer, PasswordConfirmations)
      assert.equal(fromContainer.windowMs, 5 * 60_000)
      const { default: service } = await import('../services/main.js')
      assert.strictEqual(service, fromContainer)
      // Nothing configured and nothing registered: authorize still allows, as before.
      await fixture.createUser('provider@x.test', 'pw-one-Original-7')
      const input = await fixture.login('provider@x.test', 'pw-one-Original-7')
      const request = { operation: 'a', scope: 's', intent: {}, password: 'pw-one-Original-7' }
      const issued = await fromContainer.confirmPassword(input, request)
      assert.isString(issued.confirmationId)
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  /** Registers the provider on a bare container with the given config and no limiter binding. */
  function registerWithout(config: unknown) {
    const bindingsByKey = new Map<unknown, (resolver: unknown) => Promise<unknown>>()
    const app = {
      config: { get: () => config },
      container: {
        singleton: (key: unknown, factory: (resolver: unknown) => Promise<unknown>) =>
          bindingsByKey.set(key, factory),
        hasBinding: () => false,
      },
    }
    new PasswordConfirmationsProvider(app as never).register()
    const resolver = {
      make: async (key: unknown) =>
        key === PasswordConfirmationAuthorization ? bindingsByKey.get(key)!(resolver) : {},
    }
    return () => bindingsByKey.get('password_confirmations.manager')!(resolver)
  }

  test('a missing config/password_confirmations.ts is a configuration error', async ({
    assert,
  }) => {
    await assert.rejects(registerWithout(undefined), /Invalid config\/password_confirmations.ts/)
  })

  test('throttling without the limiter provider is a configuration error', async ({ assert }) => {
    await assert.rejects(registerWithout(defineConfig()), /throttle needs @adonisjs\/limiter/)
  })

  test('throttling without a limiter is a configuration error', async ({ assert }) => {
    assert.throws(
      () =>
        new PasswordConfirmations({
          kit: {} as never,
          db: {} as never,
          config: defineConfig(),
          verifyPassword: async () => true,
        }),
      /throttle needs @adonisjs\/limiter/
    )
  })

  test('without a sign-in registry row, confirmations refuse to issue or spend', async ({
    assert,
  }) => {
    const context = { account: { id: 1 }, trx: {} }
    const kit = {
      authentication: {
        withCurrent: (_input: unknown, run: (c: unknown) => unknown) => run(context),
      },
    }
    const confirmations = new PasswordConfirmations({
      kit: kit as never,
      db: {} as never,
      config: defineConfig({ throttle: false }),
      verifyPassword: async () => true,
    })
    const request = { operation: 'a', scope: 's', intent: {} }
    await assert.rejects(
      () => confirmations.confirmPassword({ userId: 1 }, { ...request, password: 'x' }),
      /sessionManagement/
    )
    await assert.rejects(
      () => confirmations.consume(context as never, { ...request, confirmationId: 'p' }),
      /sessionManagement/
    )
  })
})
