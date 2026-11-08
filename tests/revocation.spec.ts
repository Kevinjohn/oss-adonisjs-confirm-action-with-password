/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import type { CurrentAccountInput } from '@kevinjohn/adonisjs-account-kit/types'
import type { Fixture } from './helpers.js'
import { bootFixture, codeOf, fakeSessionGuard } from './helpers.js'

const PW = 'pw-one-Original-7'
const PW2 = 'Correct-Horse-9-battery'
const request = { action: 'transfer-ownership', scope: 'company-1', intent: { toUserId: 'u2' } }
const DEAD = ['E_PASSWORD_CONFIRMATION_REQUIRED', 'E_ACCOUNT_KIT_INVALID_SESSION']

let fixture: Fixture
let users = 0

interface Account {
  email: string
  input: CurrentAccountInput
  /** A second sign-in of the same account, for revocations made from another device. */
  other: CurrentAccountInput
}

/**
 * Every Account Kit 0.3.3 path that ends a sign-in or changes credentials or account state. Each
 * returns the inputs a client could still present afterwards (kept sessions get their new revision).
 */
const paths: Record<string, (account: Account) => Promise<CurrentAccountInput[]>> = {
  'password change keeping this sign-in': async ({ input }) => {
    const { revision } = await fixture.kit.emailPasswordManagement.changePassword({
      actorId: input.userId,
      currentPassword: PW,
      newPassword: PW2,
      keepCurrent: { sessionHandle: input.sessionHandle },
    })
    return [input, { ...input, revision }]
  },
  'password change from another sign-in': async ({ input, other }) => {
    const { revision } = await fixture.kit.emailPasswordManagement.changePassword({
      actorId: input.userId,
      currentPassword: PW,
      newPassword: PW2,
      keepCurrent: { sessionHandle: other.sessionHandle },
    })
    return [input, { ...input, revision }]
  },
  'password reset': async ({ email, input }) => {
    await fixture.kit.passwordReset.request({ email, clientKey: 'test-client' })
    const token = fixture.mail.tokenFor('passwordResetProvision', email)
    await fixture.kit.passwordReset.reset({ token, password: PW2 })
    return [input]
  },
  'logout': async ({ input }) => {
    await fixture.kit.authentication.logout(fakeSessionGuard(), undefined, input)
    return [input]
  },
  'sessions.revoke of this sign-in from another device': async ({ input, other }) => {
    const id = await fixture.kit.authentication.withCurrent(input, async (c) => c.signInId!)
    await fixture.kit.authentication.sessions.revoke({ current: other, id })
    return [input]
  },
  'sessions.revokeOthers from another device': async ({ input, other }) => {
    await fixture.kit.authentication.sessions.revokeOthers({ current: other })
    return [input]
  },
  'sessions.revokeAll': async ({ input }) => {
    await fixture.kit.authentication.sessions.revokeAll({ current: input })
    return [input]
  },
  'account restriction (changeRestriction)': async ({ input }) => {
    await fixture.kit.authentication.changeRestriction({
      userId: input.userId,
      change: async (user, trx) => {
        await trx.from('users').where('id', user.id).update({ restricted: true })
      },
    })
    return [input]
  },
  'email change completed': async ({ email, input }) => {
    const newEmail = `moved-${email}`
    await fixture.kit.emailPasswordManagement.requestEmailChange({
      actorId: input.userId,
      currentPassword: PW,
      newEmail,
    })
    const token = fixture.mail.tokenFor('emailChangeProvision', newEmail)
    await fixture.kit.emailPasswordManagement.completeEmailChange({ token })
    return [input]
  },
  'account deletion': async ({ input }) => {
    await fixture.kit.accountData.delete({ actorId: input.userId, currentPassword: PW })
    return [input]
  },
  'sign-in expiry': async ({ input }) => {
    // Account Kit reads expiry with the wall clock; age the row instead of waiting 14 days.
    const id = await fixture.kit.authentication.withCurrent(input, async (c) => c.signInId!)
    await fixture.db
      .from('account_sessions')
      .where('id', id)
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    return [input]
  },
  'signing in again in the same browser': async ({ email, input }) => {
    const guard = { ...fakeSessionGuard(), previousHandle: () => input.sessionHandle }
    await fixture.kit.authentication.login({ email, password: PW, clientKey: 'test-client' }, guard)
    return [input]
  },
}

async function account(): Promise<Account> {
  const email = `revoked-${++users}@x.test`
  await fixture.createUser(email, PW)
  return { email, input: await fixture.login(email, PW), other: await fixture.login(email, PW) }
}

test.group('Revocation: every Account Kit path kills outstanding confirmations', (group) => {
  group.setup(async () => {
    fixture = await bootFixture()
    return () => fixture.close()
  })
  group.each.timeout(30_000)

  for (const [name, revoke] of Object.entries(paths)) {
    test(`${name}: an outstanding confirmation is dead afterwards`, async ({ assert }) => {
      const confirmations = fixture.confirmations()
      const acc = await account()
      const { confirmationId } = await confirmations.confirmPassword(acc.input, {
        ...request,
        password: PW,
      })
      const afterwards = await revoke(acc)
      for (const input of afterwards) {
        const spent = confirmations.withConfirmation(
          input,
          { ...request, confirmationId },
          async ({ trx }) => {
            await trx.table('effects').insert({ label: `${name}: must not happen` })
          }
        )
        assert.include(DEAD, await codeOf(spent))
      }
      const effects = await fixture.db.from('effects').where('label', `${name}: must not happen`)
      assert.lengthOf(effects, 0)
    })

    test(`${name}: a spend racing it commits first and the revocation waits`, async ({
      assert,
      cleanup,
    }) => {
      const confirmations = fixture.confirmations()
      const acc = await account()
      const { confirmationId } = await confirmations.confirmPassword(acc.input, {
        ...request,
        password: PW,
      })
      const inside = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const requested = Promise.withResolvers<void>()
      const client = fixture.db.connection().getWriteClient().client
      const acquire = client.acquireConnection
      let committed = false
      let acquired = false
      let acquiredBeforeCommit = false
      const spend = confirmations.withConfirmation(
        acc.input,
        { ...request, confirmationId },
        async ({ trx }) => {
          trx.once('commit', () => {
            committed = true
          })
          await trx.table('effects').insert({ label: `${name}: won` })
          inside.resolve()
          await release.promise
        }
      )
      let revocation: Promise<CurrentAccountInput[]> | undefined
      cleanup(async () => {
        release.resolve()
        await Promise.allSettled([spend, revocation])
        client.acquireConnection = acquire
      })
      await Promise.race([inside.promise, spend])
      // Observe the actual connection request, including nontransactional paths such as logout.
      client.acquireConnection = async function () {
        const pending = acquire.call(this)
        requested.resolve()
        const connection = await pending
        acquired = true
        acquiredBeforeCommit ||= !committed
        return connection
      }
      revocation = revoke(acc)
      await Promise.race([
        requested.promise,
        revocation.then(() => {
          throw new Error('Revocation finished without requesting the database')
        }),
      ])
      assert.isFalse(committed, 'the spend transaction must still be open at the contested request')
      assert.isFalse(acquired, 'revocation cannot acquire the held connection')
      release.resolve()
      const [, afterwards] = await Promise.all([spend, revocation])
      assert.isTrue(committed, 'the database acknowledged the spend commit')
      assert.isTrue(acquired)
      assert.isFalse(acquiredBeforeCommit, 'revocation database work must follow the spend commit')
      assert.lengthOf(await fixture.db.from('effects').where('label', `${name}: won`), 1)
      for (const input of afterwards) {
        assert.include(
          DEAD,
          await codeOf(
            confirmations.withConfirmation(input, { ...request, confirmationId }, async () => {})
          )
        )
      }
    })
  }
})
