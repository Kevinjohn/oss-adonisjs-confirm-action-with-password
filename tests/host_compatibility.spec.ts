import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { test } from '@japa/runner'
import type { Fixture } from './helpers.ts'
import { bootFixture, readCallResult } from './helpers.ts'

const PW = 'pw-one-Original-7'
const request = { operation: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }
let fixture: Fixture
let users = 0

async function signInTestUser() {
  const email = `host-${++users}@x.test`
  const id = await fixture.createUser(email, PW)
  return { id, email, input: await fixture.login(email, PW) }
}

/** The three limiter keys the package derives for an account. */
function buildThrottleKeys(userId: string | number) {
  const attempts = `password_confirmations:${createHash('sha256').update(String(userId)).digest('hex')}`
  return { attempts, failed: `${attempts}:failed`, blocked: `${attempts}:blocked` }
}

test.group('host database compatibility', (group) => {
  group.setup(async () => {
    fixture = await bootFixture({ hostProfile: true })
    await fixture.db.table('accounts').insert({ id: request.scope })
    return () => fixture.close()
  })
  group.each.timeout(60_000)

  test('a host scope foreign key accepts string users, isolates cascades and preserves spending', async ({
    assert,
  }) => {
    const { id, input } = await signInTestUser()
    assert.isString(id)
    assert.match(String(id), /^[a-f0-9-]{36}$/)
    const confirmations = await fixture.app.container.make('password_confirmations.manager')
    const scopeA = randomUUID()
    const scopeB = randomUUID()
    await fixture.db.table('accounts').insert([{ id: scopeA }, { id: scopeB }])
    const a = await confirmations.confirmPassword(input, {
      ...request,
      scope: scopeA,
      password: PW,
    })
    const b = await confirmations.confirmPassword(input, {
      ...request,
      scope: scopeB,
      password: PW,
    })

    await fixture.db.from('accounts').where('id', scopeA).delete()
    assert.isNull(
      await fixture.db.from('password_confirmations').where('id', a.confirmationId).first()
    )
    const survivor = await fixture.db
      .from('password_confirmations')
      .where('id', b.confirmationId)
      .firstOrFail()
    assert.equal(survivor.user_id, id)
    assert.equal(survivor.scope, scopeB)
    assert.isNull(survivor.consumed_at)
    await confirmations.withConfirmation(
      input,
      { ...request, scope: scopeB, confirmationId: b.confirmationId },
      async ({ trx }) => {
        await trx.table('effects').insert({ label: scopeB })
      }
    )
    const spent = await fixture.db
      .from('password_confirmations')
      .where('id', b.confirmationId)
      .firstOrFail()
    const effect = await fixture.db.from('effects').where('label', scopeB).firstOrFail()
    assert.isNotNull(spent.consumed_at)
    assert.equal(effect.label, scopeB)
  })

  test('the provider shares the host database limiter across sign-ins and isolates accounts', async ({
    assert,
  }) => {
    const { email, input } = await signInTestUser()
    const secondSignIn = await fixture.login(email, PW)
    const other = await signInTestUser()
    const confirmations = await fixture.app.container.make('password_confirmations.manager')
    const manager = await fixture.app.container.make('limiter.manager')
    const budget = manager.use({ requests: 5, duration: '1 minute' })
    const keys = buildThrottleKeys(input.userId)
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        () =>
          confirmations.confirmPassword(i % 2 ? secondSignIn : input, {
            ...request,
            password: 'wrong',
          }),
        /Incorrect password/
      )
    }
    // Five completed failures across both sign-ins arm one block, stored in the host's table.
    // Arming the block clears the counters: the block alone decides until it lapses.
    assert.isNull(await budget.get(keys.failed))
    assert.isNull(await budget.get(keys.attempts))
    assert.isAbove((await budget.get(keys.blocked))!.availableIn, 60)
    await fixture.db.from('rate_limits').where('key', 'like', `%${keys.blocked}`).firstOrFail()
    for (const session of [input, secondSignIn]) {
      await assert.rejects(
        () => confirmations.confirmPassword(session, { ...request, password: PW }),
        /Too many attempts/
      )
    }
    // Both accounts use the same sign-in client key. A different account retains its own budget.
    const otherKeys = buildThrottleKeys(other.input.userId)
    await assert.rejects(
      () => confirmations.confirmPassword(other.input, { ...request, password: 'wrong' }),
      /Incorrect password/
    )
    const otherFailed = await budget.get(otherKeys.failed)
    assert.equal(otherFailed?.consumed, 1)
    await confirmations.confirmPassword(other.input, { ...request, password: PW })
    assert.isNull(await budget.get(otherKeys.failed))
    assert.isNull(await budget.get(otherKeys.attempts))
    assert.isAbove((await budget.get(keys.blocked))!.availableIn, 60)
  })

  test('two app instances observe the same database limiter block and isolate other accounts', async ({
    assert,
  }) => {
    const peer = await bootFixture({ hostProfile: true, sharedRoot: fixture.root })
    try {
      const { email, input } = await signInTestUser()
      const peerInput = await peer.login(email, PW)
      const other = await signInTestUser()
      const first = await fixture.app.container.make('password_confirmations.manager')
      const second = await peer.app.container.make('password_confirmations.manager')
      assert.notStrictEqual(
        await fixture.app.container.make('limiter.manager'),
        await peer.app.container.make('limiter.manager')
      )

      const incorrect = { ...request, password: 'wrong' }
      for (let attempt = 0; attempt < 4; attempt++) {
        assert.equal(
          await readCallResult(first.confirmPassword(input, incorrect)),
          'E_PASSWORD_CONFIRMATION_DENIED'
        )
      }
      // Await the failure that arms the block before either app reads the shared limiter again.
      assert.equal(
        await readCallResult(second.confirmPassword(peerInput, incorrect)),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
      const correct = { ...request, password: PW }
      for (const [service, signIn] of [
        [first, input],
        [second, peerInput],
      ] as const) {
        assert.equal(
          await readCallResult(service.confirmPassword(signIn, correct)),
          'E_PASSWORD_CONFIRMATION_THROTTLED'
        )
        const { confirmationId } = await service.confirmPassword(other.input, correct)
        await service.withConfirmation(other.input, { ...request, confirmationId }, async () => {})
      }
    } finally {
      await peer.close()
    }
  })

  test('the database limiter reserves before hashing a concurrent burst with a pool of one', async ({
    assert,
  }) => {
    const { input } = await signInTestUser()
    const hash = await fixture.app.container.make('hash')
    let verified = 0
    const confirmations = fixture.makePasswordConfirmations({
      verifyPassword: async (stored, password) => {
        verified++
        return hash.verify(stored, password)
      },
    })
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        confirmations.confirmPassword(input, { ...request, password: 'wrong' }).then(
          () => 'resolved',
          (error) => error.code as string
        )
      )
    )
    assert.equal(verified, 5)
    assert.equal(results.filter((code) => code === 'E_PASSWORD_CONFIRMATION_DENIED').length, 5)
    assert.equal(results.filter((code) => code === 'E_PASSWORD_CONFIRMATION_THROTTLED').length, 25)
  })
})
