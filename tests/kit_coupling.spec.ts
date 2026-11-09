/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { liveCredentialRevision } from '../src/credential_revision.js'
import type { Fixture } from './helpers.js'
import { bootFixture } from './helpers.js'

/**
 * Canary for the two Account Kit tables this package reads. If any of these fail after a
 * Kit upgrade, confirmations may no longer bind to sign-ins or credentials: do not ship the upgrade.
 */
const KIT_READS = {
  users: ['id', 'password', 'credentials_changed_at'],
  account_sessions: ['id', 'user_id', 'handle_hash'],
}
const SUPPORTED_KIT = '0.3.3'

let fixture: Fixture

test.group('Account Kit coupling canary', (group) => {
  group.setup(async () => {
    fixture = await bootFixture()
    return () => fixture.close()
  })
  group.each.timeout(30_000)

  test('the installed Account Kit is the pinned version', async ({ assert }) => {
    const manifest = JSON.parse(
      await readFile(
        new URL('../node_modules/@kevinjohn/adonisjs-account-kit/package.json', import.meta.url),
        'utf8'
      )
    )
    const peer = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
      .peerDependencies['@kevinjohn/adonisjs-account-kit']
    assert.equal(
      manifest.version,
      SUPPORTED_KIT,
      `KIT COUPLING: installed Account Kit ${manifest.version}, verified ${SUPPORTED_KIT}. Re-run this canary and the revocation suite before changing the pin.`
    )
    assert.equal(peer, SUPPORTED_KIT, 'KIT COUPLING: peer pin and verified Kit version differ')
  })

  test('the Kit tables still have every column the package reads', async ({ assert }) => {
    for (const [table, columns] of Object.entries(KIT_READS)) {
      const info: { name: string }[] = await fixture.db.rawQuery(`pragma table_info(${table})`)
      const present = info.map((column) => column.name)
      for (const column of columns) {
        assert.include(
          present,
          column,
          `KIT COUPLING: Account Kit no longer has ${table}.${column}; password confirmations would stop ${column === 'password' ? 'verifying passwords' : table === 'users' ? 'binding to credential revisions' : 'binding to sign-ins'}.`
        )
      }
    }
    const foreignKeys: { table: string; to: string; on_delete: string }[] =
      await fixture.db.rawQuery(`pragma foreign_key_list(password_confirmations)`)
    assert.deepInclude(
      foreignKeys.map(({ table, to, on_delete: onDelete }) => ({ table, to, onDelete })),
      { table: 'account_sessions', to: 'id', onDelete: 'CASCADE' },
      'KIT COUPLING: password_confirmations.sign_in_id must cascade from account_sessions.id'
    )
  })

  test('the revision the package reads is the one the Kit advances and checks', async ({
    assert,
  }) => {
    const email = 'canary@x.test'
    await fixture.createUser(email, 'pw-one-Original-7')
    const input = await fixture.login(email, 'pw-one-Original-7')
    const read = () =>
      fixture.kit.authentication.withCurrent(current, ({ trx, account }) =>
        liveCredentialRevision(trx, 'users', account.id)
      )
    let current = input
    assert.isNull(await read(), 'KIT COUPLING: a fresh account must have no credential revision')
    const { revision } = await fixture.kit.emailPasswordManagement.changePassword({
      actorId: input.userId,
      currentPassword: 'pw-one-Original-7',
      newPassword: 'Correct-Horse-9-battery',
      keepCurrent: { sessionHandle: input.sessionHandle },
    })
    current = { ...input, revision }
    assert.isNotNull(revision)
    assert.equal(
      await read(),
      revision,
      'KIT COUPLING: users.credentials_changed_at no longer matches the revision Account Kit returns and checks'
    )
  })
})
