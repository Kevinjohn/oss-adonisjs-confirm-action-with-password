# @kevinjohn/adonisjs-confirm-action-with-password

Ask for the password again before a sensitive operation (ownership transfer, import, bulk
anonymisation) in AdonisJS 7 apps that sign in through
[Account Kit](https://github.com/Kevinjohn/oss-adonisjs-account-kit).

The user re-enters their password and gets a short-lived, single-use confirmation. The sensitive
request spends it. A confirmation is bound to the sign-in, the account's credential revision, the
operation, the resource key and the exact request, and is spent in the same transaction as the
protected change. It proves recent password confirmation, not permission to access the resource.

> Pre-release. Installed from GitHub releases; not published to npm.

## Requirements

| Need          | Detail                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js       | 24 or later                                                                                                                          |
| Account Kit   | exactly `0.4.2` for the live credential revision API (see below)                                                                     |
| Sign-in       | Account Kit `authentication.strategy: 'session'` with `sessionManagement` enabled; access tokens give no sign-in row and are refused |
| Session store | server-side (memory in tests, database or Redis); the cookie store keeps a copied session alive after sign-out                       |
| Assembler     | `@adonisjs/assembler` 8.x in the host's development dependencies for the configure codemods                                          |
| Limiter store | shared (database or Redis) when the app runs more than one process; the memory store counts per process                              |
| Database      | SQLite (tested). PostgreSQL is expected to work but is untested                                                                      |

## Install

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-confirm-action-with-password/releases/download/v0.2.2/kevinjohn-adonisjs-confirm-action-with-password-0.2.2.tgz
node ace configure @kevinjohn/adonisjs-confirm-action-with-password   # --users-table, --user-id-type as for Account Kit
node ace migration:run
```

If the original confirmations-table migration has already run, add a new migration in your host
application using the [0.2.0 schema upgrade](CHANGELOG.md#upgrade-the-confirmations-table-from-011). Run it before
deploying 0.2.0 or later. The upgrade clears existing confirmations, so users may be asked to
confirm their password again.

`configure` writes `config/password_confirmations.ts`, one migration and registers the provider. It uses
the primary Lucid connection's single configured migration path, or AdonisJS's migration directory
(`database/migrations` by default) if no path is set. With multiple migration paths, configure refuses
to guess: install the stub manually after Account Kit's migrations, or configure a single path first.
It reports inspection failures with the affected path. It never
overwrites existing files, so a rerun does not apply new flags; it warns when a file it kept
disagrees with them. After an interrupted or changed setup, check three things:

1. `table` and `usersTable` in `config/password_confirmations.ts` match the table name, the
   `user_id` reference and its column type in
   `*_create_password_confirmations_table.ts` in the configured migration directory. If the migration has already
   run, correct the config and use a new host migration for any needed schema changes. If the
   migration has never run or the setup is disposable, you can delete the generated config and
   migration and rerun configure.
2. That migration sorts after `*_account_kit_create_account_sessions.ts`. If it does not and has
   not run, rename it with a later timestamp.
3. `adonisrc.ts` lists
   `@kevinjohn/adonisjs-confirm-action-with-password/password_confirmations_provider`. Without
   `@adonisjs/assembler`, configure warns and does not add it; add the line by hand.

## User stories

See the [user story catalogue](https://github.com/Kevinjohn/oss-adonisjs-confirm-action-with-password/blob/v0.2.2/user-stories/README.md) for the source-reviewed capabilities and boundaries.

## Use

```ts
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
import { PasswordConfirmationForbiddenException } from '@kevinjohn/adonisjs-confirm-action-with-password'

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
    const owned = await trx
      .from('companies')
      .where({ id: companyId, owner_id: account.id })
      .forUpdate()
      .first()
    // Throwing rolls the spend back with the write, so the confirmation stays usable.
    if (!owned) throw new PasswordConfirmationForbiddenException()
    await trx.from('companies').where('id', companyId).update({ owner_id: toUserId })
  }
)
```

`input` is the `CurrentAccountInput` your host obtains for this request through its managed Account Kit
auth integration, the one you already pass to `kit.authentication.current`. AdonisJS's auth config
owns the actual guard names (for example, `web`). Never construct this input from untrusted request
fields. Schedule `passwordConfirmations.prune()` to delete spent and expired rows.

Host vocabulary maps to the published API: the operation name is `action`, the resource key is
`scope`, the request contents are `intent`, and spending the proof means `consume` or
`withConfirmation`. The canonical hash wrapper and stored `action`/`scope` columns retain those
names; `confirmationId` and issued deadlines remain unchanged.

A confirmation proves the account recently confirmed its password for that request, not that it may
access `scope`. The host authorisation callback `authorize` defaults to allow; only literal `true`
allows. Check the resource in `authorize`, in `run`, or both, as above. The callback may call Bouncer
but Bouncer is not required. A `run` that
returns normally commits the spend even when its update changed no row.

```ts
// config/password_confirmations.ts: refused at both issuance stages and at spend
authorize: async ({ account, trx }, { action, scope }) => {
  if (action !== 'transfer-ownership') return false
  const company = await trx.from('companies').where({ id: scope, owner_id: account.id }).first()
  return Boolean(company)
},
```

### Browser example

The [secure-note cookbook](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/blob/a8533cdd4192e98a516d60f971639ea2448d99d2/docs/cookbook/password-confirmation.md)
shows the complete two-step journey with Account Kit 0.4.2 and Password Confirmations 0.2.2:
[Hypermedia](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/tree/a8533cdd4192e98a516d60f971639ea2448d99d2/apps/hypermedia),
[Inertia React](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/tree/a8533cdd4192e98a516d60f971639ea2448d99d2/apps/inertia-react)
and [Inertia Vue](https://github.com/Kevinjohn/oss-adonisjs-starter-examples/tree/a8533cdd4192e98a516d60f971639ea2448d99d2/apps/inertia-vue).
Each validates the request, obtains the managed guard's current account input, rejects active
masquerade and checks its pending note before consuming the proof with the write. The host owns
request validation, resource checks, same-origin/CSRF protection, routes and response rendering.

### Spending inside your own `withCurrent`

```ts
await kit.authentication.withCurrent(input, async (context) => {
  await passwordConfirmations.consume(context, {
    confirmationId,
    action: 'transfer-ownership',
    scope: companyId,
    intent: { toUserId },
  })
  await context.trx.from('companies').where('id', companyId).update({ owner_id: toUserId })
})
```

Pass `consume` the `context` object `withCurrent` gave you, inside that callback. A context kept
from an earlier callback, built from request fields, or paired with a transaction you opened
yourself is not checked against the sign-in or the account lock, and the guarantees do not hold.

### What `intent` binds

- `intent` is compared as canonical JSON: own enumerable string keys of plain objects and the
  elements of arrays. Act on the same JSON value you bound, such as the parsed request body, not on
  an object carrying extra state. `-0` and `0` bind the same; send a sign that matters as a string.
- Treat it as read-only. Validate and normalise it before calling `confirmPassword` or
  `withConfirmation`, and do not change it in `authorize` or `run`: the confirmation binds the
  value as it was when the call started.
- Keep it small: ids and amounts, not documents. It is sorted, serialised and hashed
  synchronously on every call, at spend inside the account lock. For a bulk action bind a digest:
  `{ importId, sha256, rows }`.

## Rules the host must keep

- **Cross-origin protection on the issuance route is mandatory.** Before calling
  `confirmPassword`:
  - If `Sec-Fetch-Site` is present, accept only `same-origin`. It names a relationship, not an
    origin: `same-site` is another origin (a sibling subdomain), and `none` is a user-initiated
    navigation, which a scripted POST never is.
  - Otherwise, if `Origin` is present, accept only an exact match with your own origin. Refuse
    `null`.
  - If neither is present the client is not a current browser. Refuse, unless the route also
    serves non-browser clients, in which case require your CSRF token.

  ```ts
  const OWN_ORIGIN = new URL(env.get('APP_URL')).origin

  function sameOrigin(request: HttpContext['request']) {
    const site = request.header('sec-fetch-site')
    if (site !== undefined) return site === 'same-origin'
    const origin = request.header('origin')
    return origin !== undefined && origin === OWN_ORIGIN
  }
  ```

  A front end on another origin needs an allow-list for the `Origin` branch, and must accept
  `same-site` or `cross-site` for exactly those origins.

- **Wrong passwords are throttled per account** through the app's `@adonisjs/limiter` (the same
  manager Account Kit uses): 5 completed wrong passwords per minute, then blocked for 20 minutes,
  reset by a correct password; then `E_PASSWORD_CONFIRMATION_THROTTLED` (429, `retryAfterSeconds`).
  An attempt is reserved atomically before the hash, as Account Kit's sign-in does, so a parallel
  burst runs at most the budget of hashes. A check still in flight, or one whose verifier threw, is
  not a failure and does not count towards the block. Tune with
  `throttle: { requests, duration, blockDuration }`; durations are strings such as `'1 minute'` or
  whole seconds. The budget is per account only when every process shares one limiter store: with
  the memory store, N processes allow N budgets and a block on one does not hold on another. With
  `throttle: false` the host must throttle the issuance route itself, on a shared store, reserving
  before the hash (`penalize` checks then counts, so a parallel burst races through it):

  ```ts
  import { errors as limiterErrors } from '@adonisjs/limiter'
  import { errors } from '@kevinjohn/adonisjs-confirm-action-with-password'

  const budget = limiter.use({ requests: 5, duration: '1 minute' })
  const key = `confirm:${userId}`
  try {
    await budget.consume(key) // atomic reservation; throws once the budget is spent
  } catch (error) {
    if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) return response.tooManyRequests()
    throw error
  }
  try {
    const issued = await passwordConfirmations.confirmPassword(input, request)
    await budget.delete(key) // a correct password resets the budget
    return issued
  } catch (error) {
    // Only a wrong password keeps its attempt. Authorisation refusals, dead sessions, bad requests and
    // verifier faults are not guesses: give the attempt back.
    if (!(error instanceof errors.E_PASSWORD_CONFIRMATION_DENIED)) await budget.decrement(key)
    throw error
  }
  ```

  This caps wrong passwords at 5 per minute. It does not add the 20 minute block the built-in
  throttle applies; with `blockDuration` on this limiter, each refused retry restarts the block.

- **Route every credential change through Account Kit.** Writing `users.password` or
  `credentials_changed_at` directly bypasses revision binding.
- **Keep `run`, `authorize` and `readPasswordHash` database-only, on the `trx` they are given.**
  All three run inside an Account Kit transaction that SQLite may retry, and `authorize` runs
  three times per confirm-and-spend anyway. Side effects (mail, HTTP, writes on another connection)
  can repeat, and the Kit refuses a second Account Kit transaction opened inside them.
  `verifyPassword` is the exception: it runs outside any transaction, once per attempt.
  Issuance uses two separate locked Account Kit transactions: read the hash and authorise, then
  recheck and issue after the password verification. Limiter storage is outside those transactions;
  pruning uses the supplied database directly, independently of the account lock. A spend and its
  protected `run` share the same active Kit transaction and roll back together.
- **Same hash check as the Kit.**
  - _Kit SQL or Lucid adapter with its `verifyPassword` option:_ pass that same
    `(hashedPassword, password)` function as `verifyPassword` in `config/password_confirmations.ts`.
  - _Custom `UsersAdapter`:_ its `verifyPassword(id, password, trx)` method cannot be reused,
    because this package checks the hash outside the transaction. Supply `readPasswordHash` to read
    the hash under `trx`, and `verifyPassword` as a pure hash comparison shared with your adapter.
    The adapter must report `hasPassword: true` for the account, or the hash is never read.

  Either way it must return `false` for a wrong or malformed password, never throw: a throw is
  treated as an infrastructure fault, rethrown, and the attempt is refunded, so a verifier that
  throws on bad input turns every guess into a free one.

  ```ts
  // config/password_confirmations.ts, with a custom UsersAdapter
  export default defineConfig({
    readPasswordHash: async (userId, trx) => {
      const row = await trx.from('credentials').select('hash').where('user_id', userId).first()
      return row?.hash ?? null
    },
    verifyPassword: verifyHash, // the same pure comparison your adapter's verifyPassword calls
  })
  ```

- **Run configure after Account Kit's.** The confirmations migration references `account_sessions`, so it
  must sort after the Kit's migrations (PostgreSQL rejects the foreign key otherwise); `configure`
  warns when it cannot find them.
- **Keep node clocks in sync.** `verified_at` and the spend check use the app's wall clock. With
  several nodes, clock skew shifts the window by the skew; run NTP, or treat the window as
  approximate by that much.

## Account Kit storage this package reads

Issue and spend use Account Kit’s `withCurrent` context to read the live credential revision in
their transaction. The package pins Kit exactly because it still depends on the password hash
column and the sign-in table below. `tests/kit_coupling.spec.ts` fails with `KIT COUPLING:` if any of them
changes.

| Read                  | Why                                                                                                 | If it is missing or changes                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `users.password`      | the hash to verify, outside the Kit lock (the Kit's own `verifyPassword` only runs inside its lock) | the query throws, or a non-string value is a wrong password: nothing is issued |
| `account_sessions.id` | foreign key with `ON DELETE CASCADE`                                                                | the migration fails: confirmations cannot be stored                            |

## Errors

| Code                                                | Status | Meaning                                                                     |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `E_PASSWORD_CONFIRMATION_REQUIRED`                  | 403    | Missing, spent, expired, or bound to another sign-in, credential or request |
| `E_PASSWORD_CONFIRMATION_DENIED`                    | 403    | Wrong password                                                              |
| `E_PASSWORD_CONFIRMATION_THROTTLED`                 | 429    | Too many wrong passwords; `retryAfterSeconds` says when to retry            |
| `E_PASSWORD_CONFIRMATION_STALE`                     | 403    | The window passed between the password check and issue                      |
| `E_PASSWORD_CONFIRMATION_FORBIDDEN`                 | 403    | Host authorisation callback did not return literal `true`                   |
| `E_PASSWORD_CONFIRMATION_INVALID_REQUEST`           | 400    | Malformed action, scope or intent (JSON values only)                        |
| `E_PASSWORD_CONFIRMATION_SESSION_REGISTRY_REQUIRED` | 500    | No Kit sign-in row: wrong strategy or `sessionManagement` off               |
| `E_PASSWORD_CONFIRMATION_INVALID_CONFIG`            | 500    | `config/password_confirmations.ts` missing or invalid                       |

Account Kit's `E_ACCOUNT_KIT_INVALID_SESSION` passes through unchanged: sign the user out.

AdonisJS's default exception handler preserves the 429 status but does not forward
`retryAfterSeconds` as a header. In your host exception handler, add a `Retry-After` header before
delegating to your existing renderer; this keeps JSON, JSON:API, HTML and custom handling under
the host's control. Non-HTTP callers can still read the exception's `retryAfterSeconds` property.

```ts
import { ExceptionHandler, type HttpContext } from '@adonisjs/core/http'
import { PasswordConfirmationThrottledException } from '@kevinjohn/adonisjs-confirm-action-with-password'

export default class HttpExceptionHandler extends ExceptionHandler {
  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof PasswordConfirmationThrottledException) {
      ctx.response.header('Retry-After', String(error.retryAfterSeconds))
    }
    return super.handle(error, ctx)
  }
}
```

`E_ACCOUNT_KIT_POST_COMMIT` (`error.committed === true`) also passes through. The transaction
committed before it was thrown: from `withConfirmation` the confirmation is spent and your `run`
writes are stored, so do not ask for a new confirmation and repeat the action; check what was
stored. From `confirmPassword` a confirmation was issued but its id was lost: ask the user to
confirm again, and the orphan expires on its own. Every other error rolled back.

## What ends a confirmation

Every Account Kit 0.4.2 path below is tested to kill an outstanding confirmation, and a spend already in
progress commits before the revocation acquires its connection in the single-connection SQLite fixture:
password change (keeping or ending this sign-in), password reset, sign-out, `sessions.revoke`,
`revokeOthers`, `revokeAll`, `changeRestriction`, a completed email change, account deletion,
sign-in expiry, and signing in again in the same browser. Not driven by tests: social-identity
unlink (needs an Ally provider) and registration claim (needs open registration); both end
sign-ins through the same Kit code path as a password change.

Signing out and signing in again end confirmations because the Kit deletes the sign-in row, and it only
does that when the guard gives it the row to delete. Account Kit's managed routes do. A custom
session guard must pass the current `CurrentAccountInput` to `authentication.logout`, and supply
the previous session handle when a new sign-in replaces an existing one. Without those the old
sign-in row survives, and so do its confirmations until they expire or the credential revision
changes.

## Known pitfalls

- The Japa `sessionApiClient` plugin gives each request a fresh session and destroys it afterwards,
  so a sign-in never reaches the next request. Multi-request flows must drop it and carry the
  session cookie themselves.
- Account Kit's generated `config/account_kit.ts` throws from `onCredentialsChangedTransaction` and
  every `notify` callback until you implement them. Password changes fail until then.
- Moving from an app-local confirmations table with a nullable `verified_at`: the new table makes
  `verified_at` and `issued_at` NOT NULL. Drop unspent old confirmations at cutover; users confirm again.

## Contributing

Develop on Node 24: `nvm use` reads `.nvmrc`, and `pnpm check:changed` refuses other majors.
Consumers may run Node 24 or later; CI tests 24 only.

```sh
pnpm install
pnpm check:changed   # format, lint, typecheck and the tests your changes select
pnpm test            # full suite with coverage thresholds
```
