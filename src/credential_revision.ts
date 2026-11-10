/*
 * @kevinjohn/adonisjs-confirm-action-with-password
 *
 * (c) 2026 Kevinjohn Gallagher
 *
 * For the full copyright and license information, please view the LICENSE.md
 * file that was distributed with this source code.
 */

import { readTimestamp } from '@kevinjohn/adonisjs-account-kit/transaction'
import type { Trx, UserId } from '@kevinjohn/adonisjs-account-kit/types'
import { PasswordConfirmationRequiredException } from './errors.js'

/**
 * The account's live credential revision, read through the Kit transaction that holds the account
 * lock. Account Kit 0.3.4 stores it in `credentials_changed_at` and advances it on every password
 * change, reset and restriction change; `null` means no credential change has happened yet. This is
 * a Kit storage detail the package reads, which is why the Kit is pinned to an exact version.
 */
export async function liveCredentialRevision(trx: Trx, usersTable: string, userId: UserId) {
  const row = await trx
    .from(usersTable)
    .select('credentials_changed_at')
    .where('id', userId)
    .first()
  if (!row) throw new PasswordConfirmationRequiredException()
  return readTimestamp(row.credentials_changed_at)?.toUTC().toISO() ?? null
}
