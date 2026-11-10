/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { Fixture } from './helpers.js'
import { bootFixture, codeOf, fakeSessionGuard } from './helpers.js'
import type { ConfirmationRequest } from '../src/types.js'

const PW = 'pw-one-Original-7'
const PW2 = 'Correct-Horse-9-battery'
const request: ConfirmationRequest = {
  action: 'transfer-ownership',
  scope: 'company-1',
  intent: { toUserId: 'u2' },
}

let fixture: Fixture
let users = 0
async function signedIn() {
  const email = `user-${++users}@x.test`
  await fixture.createUser(email, PW)
  return { email, input: await fixture.login(email, PW) }
}

test.group('PasswordConfirmations lifecycle on Account Kit 0.3.4', (group) => {
  group.setup(async () => {
    fixture = await bootFixture()
    return () => fixture.close()
  })
  group.each.setup(() => {
    fixture.clock.now = Date.now()
  })
  group.each.timeout(30_000)

  test('issues after the password check and spends exactly once, with the product write', async ({
    assert,
  }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId, expiresAt } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    assert.equal(expiresAt, fixture.clock.now + 5 * 60_000)
    const row = await fixture.db
      .from('password_confirmations')
      .where('id', confirmationId)
      .firstOrFail()
    assert.equal(Number(row.issued_at), fixture.clock.now)
    assert.equal(Number(row.verified_at), fixture.clock.now)

    await confirmations.withConfirmation(input, { ...request, confirmationId }, async ({ trx }) => {
      await trx.from('users').where('id', input.userId).update({ email: 'spent@x.test' })
    })
    const user = await fixture.db.from('users').where('id', input.userId).firstOrFail()
    assert.equal(user.email, 'spent@x.test')
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('a wrong password issues nothing', async ({ assert }) => {
    const { input } = await signedIn()
    assert.equal(
      await codeOf(
        fixture.confirmations().confirmPassword(input, { ...request, password: 'nope' })
      ),
      'E_PASSWORD_CONFIRMATION_DENIED'
    )
    assert.lengthOf(
      await fixture.db.from('password_confirmations').where('user_id', input.userId),
      0
    )
  })

  test('binds to action, scope and the exact intent', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    for (const changed of [
      { ...request, action: 'import' },
      { ...request, scope: 'company-2' },
      { ...request, intent: { toUserId: 'u3' } },
    ]) {
      assert.equal(
        await codeOf(
          confirmations.withConfirmation(input, { ...changed, confirmationId }, async () => {})
        ),
        'E_PASSWORD_CONFIRMATION_REQUIRED'
      )
    }
    await confirmations.withConfirmation(
      input,
      { ...request, intent: { toUserId: 'u2' }, confirmationId },
      async () => {}
    )
  })

  test('a throw after the spend rolls the spend back', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    await assert.rejects(
      () =>
        confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {
          throw new Error('product failure')
        }),
      'product failure'
    )
    await confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
  })

  test('another sign-in of the same account cannot spend it', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { email, input } = await signedIn()
    const other = await fixture.login(email, PW)
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(other, { ...request, confirmationId }, async () => {})
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('the window runs from verified_at and is checked at spend', async ({ assert }) => {
    const confirmations = fixture.confirmations({ window: '2m' })
    const { input } = await signedIn()
    const { confirmationId: early } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    fixture.clock.now += 2 * 60_000 - 1
    const { confirmationId: late } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    fixture.clock.now += 1
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(input, { ...request, confirmationId: early }, async () => {})
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
    await confirmations.withConfirmation(
      input,
      { ...request, confirmationId: late },
      async () => {}
    )
  })

  test('a stall between the hash and issue past the window issues nothing', async ({ assert }) => {
    let calls = 0
    const confirmations = fixture.confirmations({
      authorize: async () => {
        // The second call runs in stage 2, after the hash.
        if (++calls === 2) fixture.clock.now += 5 * 60_000
        return true
      },
    })
    const { input } = await signedIn()
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_STALE'
    )
  })

  test('a password change during the hash refuses stage 2', async ({ assert }) => {
    const { input } = await signedIn()
    const hash = await fixture.app.container.make('hash')
    const confirmations = fixture.confirmations({
      verifyPassword: async (hashed, password) => {
        const ok = await hash.verify(hashed, password)
        await fixture.kit.emailPasswordManagement.changePassword({
          actorId: input.userId,
          currentPassword: PW,
          newPassword: PW2,
          keepCurrent: { sessionHandle: input.sessionHandle },
        })
        return ok
      },
    })
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_ACCOUNT_KIT_INVALID_SESSION'
    )
  })

  test('a password change that keeps the session kills earlier confirmations', async ({
    assert,
  }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    assert.isNull(input.revision)
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    const { revision } = await fixture.kit.emailPasswordManagement.changePassword({
      actorId: input.userId,
      currentPassword: PW,
      newPassword: PW2,
      keepCurrent: { sessionHandle: input.sessionHandle },
    })
    const kept = { ...input, revision }
    // The kept session is valid; the caller passes nothing that could widen the old confirmation.
    await fixture.kit.authentication.current(kept)
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(kept, { ...request, confirmationId }, async () => {})
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
    const fresh = await confirmations.confirmPassword(kept, { ...request, password: PW2 })
    await confirmations.withConfirmation(
      kept,
      { ...request, confirmationId: fresh.confirmationId },
      async () => {}
    )
  })

  test('logout ends the confirmation and deletes its row', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    await fixture.kit.authentication.logout(fakeSessionGuard(), undefined, input)
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
      ),
      'E_ACCOUNT_KIT_INVALID_SESSION'
    )
    assert.isNull(
      await fixture.db.from('password_confirmations').where('id', confirmationId).first()
    )
  })

  test('host policy runs at both issuance stages and at spend', async ({ assert }) => {
    const { input } = await signedIn()
    let allow = [true, false]
    const stageTwo = fixture.confirmations({ authorize: async () => allow.shift() ?? false })
    assert.equal(
      await codeOf(stageTwo.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_FORBIDDEN'
    )
    allow = [false]
    assert.equal(
      await codeOf(stageTwo.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_FORBIDDEN'
    )
    const { confirmationId } = await fixture
      .confirmations()
      .confirmPassword(input, { ...request, password: PW })
    const atSpend = fixture.confirmations({ authorize: async () => false })
    assert.equal(
      await codeOf(atSpend.withConfirmation(input, { ...request, confirmationId }, async () => {})),
      'E_PASSWORD_CONFIRMATION_FORBIDDEN'
    )
  })

  test('consume works inside a caller-owned withCurrent and refuses a missing confirmation id', async ({
    assert,
  }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    await fixture.kit.authentication.withCurrent(input, (context) =>
      confirmations.consume(context, { ...request, confirmationId })
    )
    assert.equal(
      await codeOf(
        fixture.kit.authentication.withCurrent(input, (context) =>
          confirmations.consume(context, { ...request, confirmationId: '' })
        )
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('prune removes spent and expired confirmations and keeps live ones', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    await fixture.db.from('password_confirmations').delete()
    const { email, input } = await signedIn()
    await confirmations.confirmPassword(input, { ...request, password: PW })
    const spent = await confirmations.confirmPassword(input, { ...request, password: PW })
    await confirmations.withConfirmation(
      input,
      { ...request, confirmationId: spent.confirmationId },
      async () => {}
    )
    fixture.clock.now += 5 * 60_000
    // Issued on another sign-in, so issuance does not clean the first sign-in's rows.
    const live = await confirmations.confirmPassword(await fixture.login(email, PW), {
      ...request,
      password: PW,
    })
    assert.equal(await confirmations.prune(), 2)
    const rows = await fixture.db.from('password_confirmations').select('id')
    const left = rows.map((row) => row.id)
    assert.deepEqual(left, [live.confirmationId])
  })

  test('prune removes a spent confirmation that is still inside its window', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    await fixture.db.from('password_confirmations').delete()
    const { email, input } = await signedIn()
    const spent = await confirmations.confirmPassword(input, { ...request, password: PW })
    await confirmations.withConfirmation(
      input,
      { ...request, confirmationId: spent.confirmationId },
      async () => {}
    )
    const live = await confirmations.confirmPassword(await fixture.login(email, PW), {
      ...request,
      password: PW,
    })
    assert.equal(await confirmations.prune(), 1)
    const rows = await fixture.db.from('password_confirmations').select('id')
    assert.deepEqual(
      rows.map((row) => row.id),
      [live.confirmationId]
    )
  })

  test('issuance clears spent and expired confirmations of the same sign-in', async ({
    assert,
  }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const first = await confirmations.confirmPassword(input, { ...request, password: PW })
    await confirmations.withConfirmation(
      input,
      { ...request, confirmationId: first.confirmationId },
      async () => {}
    )
    await confirmations.confirmPassword(input, { ...request, password: PW })
    assert.isNull(
      await fixture.db.from('password_confirmations').where('id', first.confirmationId).first()
    )
  })

  test('an unknown well-formed confirmation id fails exactly like a spent or mismatched one', async ({
    assert,
  }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    await confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
    const other = await confirmations.confirmPassword(input, { ...request, password: PW })
    const failures = await Promise.all(
      [
        { ...request, confirmationId: randomUUID() },
        { ...request, confirmationId },
        { ...request, scope: 'company-2', confirmationId: other.confirmationId },
      ].map((spend) =>
        confirmations
          .withConfirmation(input, spend, async () => {})
          .then(
            () => null,
            (error) => ({ code: error.code, status: error.status, message: error.message })
          )
      )
    )
    assert.deepEqual(failures[0], failures[1])
    assert.deepEqual(failures[0], failures[2])
    assert.deepEqual(failures[0], {
      code: 'E_PASSWORD_CONFIRMATION_REQUIRED',
      status: 403,
      message: 'Confirm this action again.',
    })
  })

  test('the spend window runs from verified_at, not issued_at', async ({ assert }) => {
    const windowMs = 5 * 60_000
    let calls = 0
    const confirmations = fixture.confirmations({
      authorize: async () => {
        // Stall stage 2 (second call) for most of the window: issued_at = verified_at + window - 1 s.
        if (++calls === 2) fixture.clock.now += windowMs - 1_000
        return true
      },
    })
    const { input } = await signedIn()
    const verifiedAt = fixture.clock.now
    const { confirmationId, expiresAt } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    const row = await fixture.db
      .from('password_confirmations')
      .where('id', confirmationId)
      .firstOrFail()
    assert.equal(Number(row.verified_at), verifiedAt)
    assert.equal(Number(row.issued_at), verifiedAt + windowMs - 1_000)
    assert.equal(expiresAt, verifiedAt + windowMs)
    fixture.clock.now += 2_000
    // 1 s after issue, but past verified_at + window.
    assert.equal(
      await codeOf(
        fixture
          .confirmations()
          .withConfirmation(input, { ...request, confirmationId }, async () => {})
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('the product callback never runs when the spend fails', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    let ran = 0
    for (const confirmationId of [randomUUID(), '']) {
      assert.equal(
        await codeOf(
          confirmations.withConfirmation(
            input,
            { ...request, confirmationId },
            async () => void ran++
          )
        ),
        'E_PASSWORD_CONFIRMATION_REQUIRED'
      )
    }
    assert.equal(ran, 0)
  })

  test('a confirmation row bound to another account is refused even on a matching sign-in id', async ({
    assert,
  }) => {
    // Models sign-in id reuse across accounts: the account binding must hold on its own.
    const confirmations = fixture.confirmations()
    const owner = await signedIn()
    const intruder = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(owner.input, {
      ...request,
      password: PW,
    })
    const intruderSignIn = await fixture.kit.authentication.withCurrent(
      intruder.input,
      async ({ signInId }) => signInId!
    )
    await fixture.db
      .from('password_confirmations')
      .where('id', confirmationId)
      .update({ sign_in_id: intruderSignIn, credential_revision: null })
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(
          intruder.input,
          { ...request, confirmationId },
          async () => {}
        )
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('host policy never sees the password', async ({ assert }) => {
    const seen: unknown[] = []
    const confirmations = fixture.confirmations({
      authorize: async (_context, policyRequest) => {
        seen.push(policyRequest)
        return true
      },
    })
    const { input } = await signedIn()
    const { confirmationId } = await confirmations.confirmPassword(input, {
      ...request,
      password: PW,
    })
    await confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
    assert.lengthOf(seen, 3)
    for (const policyRequest of seen) {
      assert.deepEqual(policyRequest, request)
    }
  })

  test('an account with no stored password fails closed', async ({ assert }) => {
    const { input } = await signedIn()
    let hashed = 0
    const confirmations = fixture.confirmations({
      readPasswordHash: async () => null,
      verifyPassword: async () => {
        hashed++
        return true
      },
    })
    assert.equal(
      await codeOf(confirmations.confirmPassword(input, { ...request, password: PW })),
      'E_PASSWORD_CONFIRMATION_DENIED'
    )
    // Fails closed before the hash, whatever the hash service would say.
    assert.equal(hashed, 0)
  })

  test('null revision: null matches null, null vs non-null does not', async ({ assert }) => {
    const confirmations = fixture.confirmations()
    const { input } = await signedIn()
    assert.isNull(input.revision, 'a fresh account has no credential revision')
    const nullBound = await confirmations.confirmPassword(input, { ...request, password: PW })
    const row = await fixture.db
      .from('password_confirmations')
      .where('id', nullBound.confirmationId)
      .firstOrFail()
    assert.isNull(row.credential_revision)
    // null at issue, null live: spendable.
    await confirmations.withConfirmation(
      input,
      { ...request, confirmationId: nullBound.confirmationId },
      async () => {}
    )

    const stale = await confirmations.confirmPassword(input, { ...request, password: PW })
    const { revision } = await fixture.kit.emailPasswordManagement.changePassword({
      actorId: input.userId,
      currentPassword: PW,
      newPassword: PW2,
      keepCurrent: { sessionHandle: input.sessionHandle },
    })
    assert.isNotNull(revision)
    // null at issue, non-null live: dead, even on the kept sign-in.
    assert.equal(
      await codeOf(
        confirmations.withConfirmation(
          { ...input, revision },
          { ...request, confirmationId: stale.confirmationId },
          async () => {}
        )
      ),
      'E_PASSWORD_CONFIRMATION_REQUIRED'
    )
  })

  test('wrong passwords are throttled per account through the app limiter', async ({ assert }) => {
    const confirmations = fixture.confirmations({
      throttle: { requests: 3, duration: '1 minute', blockDuration: '10 minutes' },
    })
    const { email, input } = await signedIn()
    const other = await fixture.login(email, PW)
    for (const who of [input, other, input]) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(who, { ...request, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
    const blocked = await confirmations
      .confirmPassword(input, { ...request, password: PW })
      .catch((e) => e)
    assert.equal(blocked.code, 'E_PASSWORD_CONFIRMATION_THROTTLED')
    assert.equal(blocked.status, 429)
    assert.isAbove(blocked.retryAfterSeconds, 0)
    assert.lengthOf(
      await fixture.db.from('password_confirmations').where('user_id', input.userId),
      0
    )
  })

  test('a correct password resets the failed-attempt budget', async ({ assert }) => {
    const confirmations = fixture.confirmations({ throttle: { requests: 3 } })
    const { input } = await signedIn()
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 2; i++) {
        assert.equal(
          await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
          'E_PASSWORD_CONFIRMATION_DENIED'
        )
      }
      await confirmations.confirmPassword(input, { ...request, password: PW })
    }
  })

  test('throttle: false leaves throttling to the host', async ({ assert }) => {
    const confirmations = fixture.confirmations({ throttle: false })
    const { input } = await signedIn()
    for (let i = 0; i < 7; i++) {
      assert.equal(
        await codeOf(confirmations.confirmPassword(input, { ...request, password: 'nope' })),
        'E_PASSWORD_CONFIRMATION_DENIED'
      )
    }
  })

  test('sign-in ids are not reused after the newest is deleted (SQLite AUTOINCREMENT)', async ({
    assert,
  }) => {
    const { email } = await signedIn()
    const a = await fixture.login(email, PW)
    const [newest] = await fixture.db.from('account_sessions').max('id as id')
    const top = Number(newest.id)
    await fixture.kit.authentication.logout(fakeSessionGuard(), undefined, a)
    const b = await fixture.login(email, PW)
    const id = await fixture.kit.authentication.withCurrent(b, async ({ signInId }) => signInId!)
    assert.isAbove(id, top)
  })
})
