# @kevinjohn/adonisjs-confirm-action-with-password

Ask for the password again before a sensitive action (ownership transfer, import, bulk
anonymisation) in AdonisJS 7 apps that sign in through
[Account Kit](https://github.com/Kevinjohn/oss-adonisjs-account-kit).

The user re-enters their password and gets a short-lived, single-use confirmation. The sensitive
request spends it. A confirmation is bound to the sign-in, the account's credential revision, the
action, the scope and the exact request, and is spent in the same transaction as the change it
authorizes.

> Pre-release. Installed from GitHub releases; not published to npm.

## Requirements

| Need          | Detail                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js       | 24 or later                                                                                                                          |
| Account Kit   | exactly `0.3.4`; the package reads three Kit storage details (see below)                                                             |
| Login         | Account Kit `authentication.strategy: 'session'` with `sessionManagement` enabled; access tokens give no sign-in row and are refused |
| Session store | server-side (memory in tests, database or Redis); the cookie store keeps a copied session alive after logout                         |
| Database      | SQLite (tested). PostgreSQL is expected to work but is untested                                                                      |

## Install

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-confirm-action-with-password/releases/download/v0.1.0/kevinjohn-adonisjs-confirm-action-with-password-0.1.0.tgz
node ace configure @kevinjohn/adonisjs-confirm-action-with-password   # --users-table, --user-id-type as for Account Kit
node ace migration:run
```

`configure` writes `config/password_confirmations.ts`, one migration and registers the provider. It never
overwrites existing files.

## User stories

See the [user story catalogue](user-stories/README.md) for the source-reviewed capabilities and boundaries.

## Use

```ts
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'

// POST /confirmations: password -> confirmation
const { confirmationId, expiresAt } = await passwordConfirmations.confirmPassword(input, {
  action: 'transfer-ownership',
  scope: companyId,
  intent: { toUserId },
  password,
})

// POST /transfers: spend and change in one Account Kit transaction
await passwordConfirmations.withConfirmation(
  input,
  { confirmationId, action: 'transfer-ownership', scope: companyId, intent: { toUserId } },
  async ({ account, trx }) => {
    await trx.from('companies').where('id', companyId).update({ owner_id: toUserId })
  }
)
```

`input` is the `CurrentAccountInput` you already pass to `kit.authentication.current`. Inside your
own `withCurrent` callback call `passwordConfirmations.consume(context, request)` instead of `withConfirmation`.
Schedule `passwordConfirmations.prune()` to delete spent and expired rows.

## Rules the host must keep

- **Cross-origin protection on the issuance route is mandatory.** Reject requests whose `Origin`
  (or `Sec-Fetch-Site`) is not your own origin before calling `confirmPassword`.
- **Wrong passwords are throttled per account** through the app's `@adonisjs/limiter` (the same
  manager Account Kit uses): 5 failures per minute, then blocked for 20 minutes, reset by a correct
  password; then `E_PASSWORD_CONFIRMATION_THROTTLED` (429, `retryAfterSeconds`). An attempt is reserved
  atomically before the hash, as Account Kit's login does, so a parallel burst runs at most the
  budget of hashes. Tune with `throttle: { requests, duration, blockDuration }`. With
  `throttle: false` the host must throttle the issuance route itself, reserving before the hash
  (`penalize` checks then counts, so a parallel burst races through it):

  ```ts
  import { errors } from '@adonisjs/limiter'

  const budget = limiter.use({ requests: 5, duration: '1 minute', blockDuration: '20 minutes' })
  const key = `confirm:${userId}`
  try {
    await budget.consume(key) // atomic reservation; throws once the budget is spent
  } catch (error) {
    if (error instanceof errors.E_TOO_MANY_REQUESTS) return response.tooManyRequests()
    throw error
  }
  const issued = await passwordConfirmations.confirmPassword(input, request) // E_PASSWORD_CONFIRMATION_DENIED keeps the attempt
  await budget.delete(key) // a correct password resets the budget
  ```

- **Route every credential change through Account Kit.** Writing `users.password` or
  `credentials_changed_at` directly bypasses revision binding.
- **Keep `run` database-only.** SQLite may retry `withCurrent` callbacks.
- **Same `verifyPassword` as the Kit.** If your Kit users adapter has a custom `verifyPassword`, pass
  the same function in `config/password_confirmations.ts`. It must return `false` for a wrong or malformed
  password, never throw: a throw is treated as an infrastructure fault, rethrown, and the attempt
  is refunded, so a verifier that throws on bad input turns every guess into a free one.
- **Run configure after Account Kit's.** The confirmations migration references `account_sessions`, so it
  must sort after the Kit's migrations (PostgreSQL rejects the foreign key otherwise); `configure`
  warns when it cannot find them.
- **Keep node clocks in sync.** `verified_at` and the spend check use the app's wall clock. With
  several nodes, clock skew shifts the window by the skew; run NTP, or treat the window as
  approximate by that much.

## Account Kit storage this package reads

Account Kit 0.3.4 has no public API for these, so the package reads them directly. That is why it
pins the Kit exactly. `tests/kit_coupling.spec.ts` fails with `KIT COUPLING:` if any of them
changes.

| Read                           | Why                                                                                                 | If it is missing or changes                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `users.credentials_changed_at` | the live credential revision                                                                        | the query throws: nothing is issued or spent                                   |
| `users.password`               | the hash to verify, outside the Kit lock (the Kit's own `verifyPassword` only runs inside its lock) | the query throws, or a non-string value is a wrong password: nothing is issued |
| `account_sessions.id`          | foreign key with `ON DELETE CASCADE`                                                                | the migration fails: confirmations cannot be stored                            |

## Errors

| Code                                                | Status | Meaning                                                                     |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `E_PASSWORD_CONFIRMATION_REQUIRED`                  | 403    | Missing, spent, expired, or bound to another sign-in, credential or request |
| `E_PASSWORD_CONFIRMATION_DENIED`                    | 403    | Wrong password                                                              |
| `E_PASSWORD_CONFIRMATION_STALE`                     | 403    | The window passed between the password check and issue                      |
| `E_PASSWORD_CONFIRMATION_FORBIDDEN`                 | 403    | `authorize` returned false                                                  |
| `E_PASSWORD_CONFIRMATION_INVALID_REQUEST`           | 400    | Malformed action, scope or intent (JSON values only)                        |
| `E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED` | 500    | No Kit sign-in row: wrong strategy or `sessionManagement` off               |
| `E_PASSWORD_CONFIRMATION_INVALID_CONFIG`            | 500    | `config/password_confirmations.ts` missing or invalid                       |

Account Kit's `E_ACCOUNT_KIT_INVALID_SESSION` passes through unchanged: sign the user out.

## What ends a confirmation

Every Account Kit 0.3.4 path below is tested to kill an outstanding confirmation, and a spend already in
progress commits before the revocation acquires its connection in the single-connection SQLite fixture:
password change (keeping or ending this sign-in), password reset, logout, `sessions.revoke`,
`revokeOthers`, `revokeAll`, `changeRestriction`, a completed email change, account deletion,
sign-in expiry, and signing in again in the same browser. Not driven by tests: social-identity
unlink (needs an Ally provider) and registration claim (needs open registration); both end
sign-ins through the same Kit code path as a password change.

## Known pitfalls

- The Japa `sessionApiClient` plugin gives each request a fresh session and destroys it afterwards,
  so a sign-in never reaches the next request. Multi-request flows must drop it and carry the
  session cookie themselves.
- Account Kit's generated `config/account_kit.ts` throws from `onCredentialsChangedTransaction` and
  every `notify` callback until you implement them. Password changes fail until then.
- Moving from an app-local confirmations table with a nullable `verified_at`: the new table makes
  `verified_at` and `issued_at` NOT NULL. Drop unspent old confirmations at cutover; users confirm again.
