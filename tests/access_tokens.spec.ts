/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { bootFixture } from './helpers.js'

test('the real Kit with access tokens gives no sign-in row, so confirmations refuse', async ({
  assert,
}) => {
  const fixture = await bootFixture({ strategy: 'access_tokens' })
  try {
    const userId = await fixture.createUser('token@x.test', 'pw-one-Original-7')
    const [tokenId] = await fixture.db
      .table('auth_access_tokens')
      .insert({ tokenable_id: userId })
      .returning('id')
    const input = { userId, tokenId: typeof tokenId === 'object' ? tokenId.id : tokenId }
    // The Kit accepts the token: this is a valid signed-in caller.
    await fixture.kit.authentication.current(input)
    const confirmations = fixture.confirmations()
    const request = { action: 'a', scope: 's', intent: {} }
    for (const attempt of [
      confirmations.confirmPassword(input, { ...request, password: 'pw-one-Original-7' }),
      confirmations.withConfirmation(input, { ...request, confirmationId: 'p' }, async () => {}),
    ]) {
      const error = await attempt.catch((e) => e)
      assert.equal(error.code, 'E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED')
    }
  } finally {
    await fixture.close()
  }
}).timeout(30_000)
