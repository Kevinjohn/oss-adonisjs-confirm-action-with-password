/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { createHash } from 'node:crypto'
import { test } from '@japa/runner'
import type { Limiter } from '@adonisjs/limiter'
import { PasswordConfirmations } from '../src/password_confirmations.js'
import { defineConfig } from '../src/define_config.js'
import type { ConfirmationThrottle, PasswordConfirmationsConfig } from '../src/types.js'
import type { Fixture } from './helpers.js'
import { bootFixture, codeOf } from './helpers.js'

const PW = 'pw-one-Original-7'
const request = { action: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }

let fixture: Fixture
let users = 0
async function signedIn() {
  const email = `throttled-${++users}@x.test`
  await fixture.createUser(email, PW)
  return { email, input: await fixture.login(email, PW) }
}

/** Resolves `reached` once `mark()` has been called `count` times: a stage announcing itself. */
function entry(count = 1) {
  const reached = Promise.withResolvers<void>()
  let seen = 0
  return {
    reached: reached.promise,
    mark() {
      if (++seen === count) reached.resolve()
    },
  }
}

/** The three limiter keys the package derives for an account. */
function throttleKeys(userId: string | number) {
  const attempts = `password_confirmations:${createHash('sha256').update(String(userId)).digest('hex')}`
  return { attempts, failed: `${attempts}:failed`, blocked: `${attempts}:blocked` }
}

/**
 * A PasswordConfirmations on the fixture whose limiter calls can be held: `hold[name]` makes every
 * `name` call wait until it is resolved, to pin an ordering the real store only reaches by chance.
 * `seen[name]` is called with the key as each `name` call arrives, before it is held.
 */
async function withHeldLimiter(
  config: PasswordConfirmationsConfig,
  hold: Partial<Record<'decrement' | 'delete', Promise<void>>>,
  seen: Partial<Record<string, (key: string) => void>> = {}
) {
  const manager = await fixture.app.container.make('limiter.manager')
  const hash = await fixture.app.container.make('hash')
  const held = (limiter: Limiter): Limiter =>
    new Proxy(limiter, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        const gate = hold[property as keyof typeof hold]
        const notice = seen[property as string]
        if (typeof value !== 'function' || (!gate && !notice)) {
          return typeof value === 'function' ? value.bind(target) : value
        }
        return async (...args: unknown[]) => {
          notice?.(args[0] as string)
          await gate
          return value.apply(target, args)
        }
      },
    })
  return new PasswordConfirmations({
    kit: fixture.kit,
    db: fixture.db,
    limiter: {
      use: ((options: ConfirmationThrottle) =>
        held(manager.use(options))) as unknown as typeof manager.use,
    },
    config: defineConfig(config),
    verifyPassword: (hashed, password) => hash.verify(hashed, password),
    now: () => fixture.clock.now,
  })
}

test.group('Wrong-password throttling', (group) => {
  group.setup(async () => {
    fixture = await bootFixture()
    return () => fixture.close()
  })
  group.each.setup(() => {
    fixture.clock.now = Date.now()
  })
  group.each.timeout(60_000)

  test('refunds of attempts rejected while the budget was full cannot reopen the block', async ({
    assert,
  }) => {
    const refunds = Promise.withResolvers<void>()
    const hashGate = Promise.withResolvers<void>()
    const hashing = entry(2)
    const refunding = entry(2)
    const hash = await fixture.app.container.make('hash')
    const confirmations = await withHeldLimiter(
      {
        throttle: { requests: 2, duration: '1 minute', blockDuration: '20 minutes' },
        verifyPassword: async (hashed, password) => {
          hashing.mark()
          await hashGate.promise
          return hash.verify(hashed, password)
        },
      },
      { decrement: refunds.promise },
      { decrement: refunding.mark }
    )
    const { input } = await signedIn()
    // Two wrong attempts hold the budget while two more are rejected; their refunds are delayed
    // until after the wrong passwords have blocked the account.
    const wrong = [1, 2].map(() =>
      codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' }))
    )
    await hashing.reached
    const rejected = [1, 2].map(() =>
      codeOf(confirmations.confirmPassword(input, { ...request, password: PW }))
    )
    await refunding.reached
    hashGate.resolve()
    assert.deepEqual(await Promise.all(wrong), [
      'E_PASSWORD_CONFIRMATION_DENIED',
      'E_PASSWORD_CONFIRMATION_DENIED',
    ])
    refunds.resolve()
    assert.deepEqual(await Promise.all(rejected), [
      'E_PASSWORD_CONFIRMATION_THROTTLED',
      'E_PASSWORD_CONFIRMATION_THROTTLED',
    ])
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('the window runs from the password check, not from the limiter reset after it', async ({
    assert,
  }) => {
    const reset = Promise.withResolvers<void>()
    const resetting = entry()
    const confirmations = await withHeldLimiter(
      { window: '2m' },
      { delete: reset.promise },
      { delete: resetting.mark }
    )
    const { input } = await signedIn()
    const issuing = codeOf(confirmations.confirmPassword(input, { ...request, password: PW }))
    // The reset is requested only after the password was checked and its time recorded.
    await resetting.reached
    // The limiter reset stalls for the whole window after the password was checked.
    fixture.clock.now += 2 * 60_000
    reset.resolve()
    assert.equal(await issuing, 'E_PASSWORD_CONFIRMATION_STALE')
  })

  test('a burst behind a full budget is refused, right password included', async ({ assert }) => {
    const hash = await fixture.app.container.make('hash')
    const hashGate = Promise.withResolvers<void>()
    const hashing = entry(5)
    let verified = 0
    const confirmations = fixture.confirmations({
      throttle: { requests: 5, duration: '1 minute', blockDuration: '20 minutes' },
      verifyPassword: async (hashed, password) => {
        verified++
        hashing.mark()
        await hashGate.promise
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    const admitted = Array.from({ length: 5 }, (_, i) =>
      codeOf(confirmations.confirmPassword(input, { ...request, password: `nope-${i}` }))
    )
    // All five checks hold the budget before anything else is submitted.
    await hashing.reached
    const late = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        codeOf(
          confirmations.confirmPassword(input, {
            ...request,
            password: i === 24 ? PW : `late-${i}`,
          })
        )
      )
    )
    assert.deepEqual(new Set(late), new Set(['E_PASSWORD_CONFIRMATION_THROTTLED']))
    hashGate.resolve()
    assert.deepEqual(
      new Set(await Promise.all(admitted)),
      new Set(['E_PASSWORD_CONFIRMATION_DENIED'])
    )
    assert.equal(verified, 5)
    // Five wrong passwords completed, so the right one is refused afterwards too.
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('the right password inside the budget wins while wrong ones are still in flight', async ({
    assert,
  }) => {
    const hash = await fixture.app.container.make('hash')
    const wrongGate = Promise.withResolvers<void>()
    const hashing = entry(4)
    const confirmations = fixture.confirmations({
      throttle: { requests: 5, duration: '1 minute', blockDuration: '20 minutes' },
      verifyPassword: async (hashed, password) => {
        if (password !== PW) {
          hashing.mark()
          await wrongGate.promise
        }
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    const wrong = Array.from({ length: 4 }, (_, i) =>
      codeOf(confirmations.confirmPassword(input, { ...request, password: `nope-${i}` }))
    )
    await hashing.reached
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
    wrongGate.resolve()
    assert.deepEqual(new Set(await Promise.all(wrong)), new Set(['E_PASSWORD_CONFIRMATION_DENIED']))
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

  test('a failed refund keeps the verifier fault that caused it', async ({ assert }) => {
    const manager = await fixture.app.container.make('limiter.manager')
    const verifierFault = new Error('hash backend down')
    const refundFault = new Error('limiter store down')
    const confirmations = new PasswordConfirmations({
      kit: fixture.kit,
      db: fixture.db,
      limiter: {
        use: ((options: ConfirmationThrottle) =>
          new Proxy(manager.use(options), {
            get(target, property, receiver) {
              if (property === 'decrement') return async () => Promise.reject(refundFault)
              const value = Reflect.get(target, property, receiver)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })) as unknown as typeof manager.use,
      },
      config: defineConfig({ throttle: { requests: 1 } }),
      verifyPassword: async () => Promise.reject(verifierFault),
    })
    const { input } = await signedIn()
    const error = await confirmations
      .confirmPassword(input, { ...request, password: PW })
      .catch((e) => e)
    assert.instanceOf(error, AggregateError)
    assert.deepEqual(error.errors, [verifierFault, refundFault])
    assert.strictEqual(error.cause, verifierFault)
  })

  test('a throttled attempt does not eat the refund of a faulted one', async ({ assert }) => {
    const hash = await fixture.app.container.make('hash')
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const hashing = entry()
    let fault = true
    const confirmations = fixture.confirmations({
      throttle: { requests: 1 },
      verifyPassword: async (hashed, password) => {
        if (fault) {
          fault = false
          hashing.mark()
          await gate
          throw new Error('hash backend down')
        }
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    // A holds the only slot while its hash hangs; B arrives and is throttled; then A faults.
    const first = confirmations.confirmPassword(input, { ...request, password: PW }).catch((e) => e)
    await hashing.reached
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

  test('a check still in flight is not a failure and does not arm the block', async ({
    assert,
  }) => {
    const hash = await fixture.app.container.make('hash')
    const faultGate = Promise.withResolvers<void>()
    const hashing = entry()
    let fault = true
    const confirmations = fixture.confirmations({
      throttle: { requests: 2 },
      verifyPassword: async (hashed, password) => {
        if (fault) {
          fault = false
          hashing.mark()
          await faultGate.promise
          throw new Error('hash backend down')
        }
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    // Two checks hold the whole budget; only one of them ends as a wrong password.
    const faulting = confirmations
      .confirmPassword(input, { ...request, password: PW })
      .catch((e) => e)
    await hashing.reached
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
      'E_PASSWORD_CONFIRMATION_DENIED'
    )
    faultGate.resolve()
    const faulted = await faulting
    assert.equal(faulted.message, 'hash backend down')
    // One failure against a budget of two: the right password still goes through.
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
  })

  test('a fault that settles after a correct password cannot erase a later failure', async ({
    assert,
  }) => {
    const hash = await fixture.app.container.make('hash')
    const faultGate = Promise.withResolvers<void>()
    const hashing = entry()
    let fault = true
    const confirmations = fixture.confirmations({
      throttle: { requests: 3 },
      verifyPassword: async (hashed, password) => {
        if (fault) {
          fault = false
          hashing.mark()
          await faultGate.promise
          throw new Error('hash backend down')
        }
        return hash.verify(hashed, password)
      },
    })
    const { input } = await signedIn()
    const faulting = confirmations
      .confirmPassword(input, { ...request, password: PW })
      .catch((e) => e)
    await hashing.reached
    // A correct password resets the budget while the faulting check is still in flight.
    await confirmations.confirmPassword(input, { ...request, password: PW })
    for (let i = 0; i < 2; i++) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    // The late refund lands in the new budget. It may free a slot; it must not uncount a failure.
    faultGate.resolve()
    const faulted = await faulting
    assert.equal(faulted.message, 'hash backend down')
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
      'E_PASSWORD_CONFIRMATION_DENIED'
    )
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
  })

  test('limiter keys are a fixed width whatever the account id', async ({ assert }) => {
    const keys = new Set<string>()
    const record = (key: string) => void keys.add(key)
    const confirmations = await withHeldLimiter(
      { throttle: { requests: 1 } },
      {},
      { consume: record, get: record, increment: record, set: record, delete: record }
    )
    const { input } = await signedIn()
    await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' }))
    await codeOf(confirmations.confirmPassword(input, { ...request, password: PW }))
    const expected = throttleKeys(input.userId)
    assert.deepEqual([...keys].sort(), Object.values(expected).sort())
    // 23 + 64 + 8: inside the 255-character key column of the limiter's database store.
    for (const key of keys) assert.isAtMost(key.length, 95)
  })

  test('a throttled retry during the block never extends it', async ({ assert }) => {
    const confirmations = fixture.confirmations({
      throttle: { requests: 2, duration: '1s', blockDuration: '2s' },
    })
    const { input } = await signedIn()
    for (let i = 0; i < 2; i++) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    const blockedAt = Date.now()
    // A retry inside the block is refused and must not restart the 2 s clock. These two waits
    // measure the block's own time-to-live.
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_THROTTLED'
    )
    await new Promise((resolve) => setTimeout(resolve, blockedAt + 2_500 - Date.now()))
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'resolved'
    )
  })
})
