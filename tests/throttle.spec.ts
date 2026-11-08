/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import type { Fixture } from './helpers.js'
import { bootFixture } from './helpers.js'

const PW = 'pw-one-Original-7'
const request = { action: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }

let fixture: Fixture
let users = 0
async function signedIn() {
  const email = `throttled-${++users}@x.test`
  await fixture.createUser(email, PW)
  return { email, input: await fixture.login(email, PW) }
}
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error) => error.code as string
  )

test.group('Wrong-password throttling', (group) => {
  group.setup(async () => {
    fixture = await bootFixture()
    return () => fixture.close()
  })
  group.each.timeout(60_000)

  test('a parallel burst verifies at most the budget, right password included', async ({
    assert,
  }) => {
    const hash = await fixture.app.container.make('hash')
    let verified = 0
    const confirmations = fixture.confirmations({
      throttle: { requests: 5, duration: '1 minute', blockDuration: '20 minutes' },
      verifyPassword: async (hashed, password) => {
        verified++
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    const attempts = Array.from({ length: 30 }, (_, i) =>
      codeOf(
        confirmations.confirmPassword(input, { ...request, password: i === 29 ? PW : `nope-${i}` })
      )
    )
    const outcomes = await Promise.all(attempts)
    assert.isAtMost(verified, 5, `the hash ran ${verified} times for a budget of 5`)
    assert.equal(outcomes.filter((code) => code === 'E_PASSWORD_CONFIRMATION_THROTTLED').length, 25)
    assert.notInclude(outcomes.slice(0, 29), 'resolved')
    // The burst exhausted the budget, so the right password is refused afterwards too.
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('the block outlasts the counting window and then lifts', async ({ assert }) => {
    const confirmations = fixture.confirmations({
      throttle: { requests: 2, duration: '1s', blockDuration: '4s' },
    })
    const { input } = await signedIn()
    for (let i = 0; i < 2; i++) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    const blocked = await confirmations
      .confirmPassword(input, { ...request, password: PW })
      .catch((e) => e)
    assert.equal(blocked.code, 'E_PASSWORD_CONFIRMATION_THROTTLED')
    assert.isAbove(blocked.retryAfterSeconds, 1)
    // Past the 1 s counting window, still inside the 4 s block.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
  })

  test('the budget is per account across actions and scopes', async ({ assert }) => {
    const confirmations = fixture.confirmations({ throttle: { requests: 3 } })
    const { input } = await signedIn()
    for (const changed of [
      { ...request, action: 'import' },
      { ...request, scope: 'company-2' },
      { ...request, action: 'anonymise', intent: {} },
    ]) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(input, { ...changed, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('a non-string password is refused like a wrong one and counts', async ({ assert }) => {
    const hash = await fixture.app.container.make('hash')
    const hashed: unknown[] = []
    const confirmations = fixture.confirmations({
      throttle: { requests: 2 },
      verifyPassword: async (stored, password) => {
        hashed.push(password)
        return hash.verify(stored, password)
      },
    })
    const { input } = await signedIn()
    for (const password of [123, null]) {
      assert.equal(
        await codeOf(
          confirmations.confirmPassword(input, {
            ...request,
            password: password as unknown as string,
          })
        ),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    // Refused before the hash: a non-string never reaches the hash service.
    assert.deepEqual(hashed, [])
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('a hash failure is not a wrong guess and gives the attempt back', async ({ assert }) => {
    const hash = await fixture.app.container.make('hash')
    let broken = true
    const confirmations = fixture.confirmations({
      throttle: { requests: 1 },
      verifyPassword: async (hashed, password) => {
        if (broken) throw new Error('hash backend down')
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    for (let i = 0; i < 3; i++) {
      const error = await confirmations
        .confirmPassword(input, { ...request, password: PW })
        .catch((e) => e)
      assert.equal(error.message, 'hash backend down')
    }
    broken = false
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
  })

  test('a throttled attempt does not eat the refund of a faulted one', async ({ assert }) => {
    const hash = await fixture.app.container.make('hash')
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let fault = true
    const confirmations = fixture.confirmations({
      throttle: { requests: 1 },
      verifyPassword: async (hashed, password) => {
        if (fault) {
          fault = false
          await gate
          throw new Error('hash backend down')
        }
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    // A holds the only slot while its hash hangs; B arrives and is throttled; then A faults.
    const first = confirmations.confirmPassword(input, { ...request, password: PW }).catch((e) => e)
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
    release()
    const faulted = await first
    assert.equal(faulted.message, 'hash backend down')
    // A's slot came back in full, so the right password goes through.
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
  })
})
