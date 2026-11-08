import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { Fixture } from './helpers.js'
import { bootFixture } from './helpers.js'

const PW = 'pw-one-Original-7'
const request = { action: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }
let fixture: Fixture
let users = 0

async function signedIn() {
  const email = `host-${++users}@x.test`
  const id = await fixture.createUser(email, PW)
  return { id, email, input: await fixture.login(email, PW) }
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
    const { id, input } = await signedIn()
    assert.isString(id)
    assert.match(String(id), /^[a-f0-9-]{36}$/)
    const confirmations = await fixture.app.container.make('password_confirmations')
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
    const { email, input } = await signedIn()
    const secondSignIn = await fixture.login(email, PW)
    const other = await signedIn()
    const confirmations = await fixture.app.container.make('password_confirmations')
    const manager = await fixture.app.container.make('limiter.manager')
    const budget = manager.use({ requests: 5, duration: '1 minute', blockDuration: '20 minutes' })
    const key = `password_confirmations:${input.userId}`
    await budget.consume(key)
    for (let i = 0; i < 4; i++) {
      await assert.rejects(
        () =>
          confirmations.confirmPassword(i % 2 ? secondSignIn : input, {
            ...request,
            password: 'wrong',
          }),
        /Incorrect password/
      )
    }
    const blockedCount = (await budget.get(key))!.consumed
    assert.isAtLeast(blockedCount, 5)
    assert.isAbove((await budget.get(key))!.availableIn, 60)
    const persisted = await fixture.db
      .from('rate_limits')
      .where('key', 'like', `%${key}`)
      .firstOrFail()
    assert.equal(persisted.points, blockedCount)
    for (const session of [input, secondSignIn]) {
      await assert.rejects(
        () => confirmations.confirmPassword(session, { ...request, password: PW }),
        /Too many attempts/
      )
    }
    // Both accounts use the same login client key. A different account retains its own budget.
    await assert.rejects(
      () => confirmations.confirmPassword(other.input, { ...request, password: 'wrong' }),
      /Incorrect password/
    )
    const otherBudget = await budget.get(`password_confirmations:${other.input.userId}`)
    assert.equal(otherBudget?.consumed, 1)
    await confirmations.confirmPassword(other.input, { ...request, password: PW })
    assert.isNull(await budget.get(`password_confirmations:${other.input.userId}`))
    const stillBlocked = await budget.get(key)
    assert.equal(stillBlocked?.consumed, blockedCount)
  })

  test('the database limiter reserves before hashing a concurrent burst with a pool of one', async ({
    assert,
  }) => {
    const { input } = await signedIn()
    const hash = await fixture.app.container.make('hash')
    let verified = 0
    const confirmations = fixture.confirmations({
      verifyPassword: async (stored, password) => {
        verified++
        return hash.verify(stored, password)
      },
    })
    const outcomes = await Promise.all(
      Array.from({ length: 30 }, () =>
        confirmations.confirmPassword(input, { ...request, password: 'wrong' }).then(
          () => 'resolved',
          (error) => error.code as string
        )
      )
    )
    assert.equal(verified, 5)
    assert.equal(outcomes.filter((code) => code === 'E_PASSWORD_CONFIRMATION_DENIED').length, 5)
    assert.equal(outcomes.filter((code) => code === 'E_PASSWORD_CONFIRMATION_THROTTLED').length, 25)
  })
})
