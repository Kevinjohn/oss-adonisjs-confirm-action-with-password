/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { PasswordConfirmations } from '../src/password_confirmations.js'
import { defineConfig } from '../src/define_config.js'
import PasswordConfirmationsProvider from '../providers/password_confirmations_provider.js'
import { bootFixture } from './helpers.js'

test.group('provider and service', () => {
  test('the container and services/main resolve one PasswordConfirmations from config', async ({
    assert,
  }) => {
    const fixture = await bootFixture()
    try {
      const fromContainer = await fixture.app.container.make('password_confirmations')
      assert.instanceOf(fromContainer, PasswordConfirmations)
      assert.equal(fromContainer.windowMs, 5 * 60_000)
      assert.strictEqual(await fixture.app.container.make(PasswordConfirmations), fromContainer)
      const { default: service } = await import('../services/main.js')
      assert.strictEqual(service, fromContainer)
    } finally {
      await fixture.close()
    }
  }).timeout(30_000)

  test('a missing config/password_confirmations.ts is a configuration error', async ({
    assert,
  }) => {
    const bindings = new Map<unknown, (resolver: unknown) => Promise<unknown>>()
    const app = {
      config: { get: () => undefined },
      container: {
        singleton: (key: unknown, factory: (resolver: unknown) => Promise<unknown>) =>
          bindings.set(key, factory),
        alias: () => {},
      },
    }
    new PasswordConfirmationsProvider(app as never).register()
    await assert.rejects(
      () => bindings.get(PasswordConfirmations)!({ make: async () => ({}) }),
      /Invalid config\/password_confirmations.ts/
    )
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
    const request = { action: 'a', scope: 's', intent: {} }
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
