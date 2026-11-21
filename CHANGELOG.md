# Changelog

## Unreleased

- Use the primary Lucid connection's migration directory during configure, refuse ambiguous paths,
  and report non-missing inspection errors without overwriting existing files.
- Export `PasswordConfirmationsDependencies` from `./types` as well as the existing root import.
- Clarify password proof versus resource permission, document the host `Retry-After` integration,
  and link the secure-note browser examples. Existing confirmation bindings and deadlines are unchanged.
- Gate release archives on independent SQLite consumers using TypeScript 5.9.3 and 6.0.3.

## 0.2.2 - 2026-11-21

- Read the live credential revision through Account Kit's callback context inside the existing
  authenticated transaction, instead of querying the Kit's `credentials_changed_at` column directly.
- Require Account Kit 0.4.2.

## 0.2.1 - 2026-11-19

- Accept Account Kit credential objects with a getter-backed revision. Confirmation revocation
  still follows Account Kit's sign-in and credential changes.
- Require Account Kit 0.4.1 and verify that separate application instances share throttling state
  when configured to use the same limiter store.
- Document the confirmations table migration from 0.1.1. The 0.2.1 patch adds no new schema change.
- Check literal formatter filenames, clean up timed-out check processes, and require a valid archive
  digest before publishing.

## 0.2.0 - 2026-11-17

- The README covers resource authorization in the transfer example, the low-level `consume` call,
  what `intent` binds, separate `Origin` and `Sec-Fetch-Site` checks, shared limiter storage, a
  host-throttling example that keeps only wrong passwords, the two Kit verifier signatures,
  retry-safe callbacks, committed-error recovery, custom session guard wiring and configure reruns.

- Breaking: the confirmations table has a new NOT NULL `expires_at` column holding the deadline
  returned by `confirmPassword`. Spend, issue-time cleanup and `prune()` use it, so a longer
  `window` configured later cannot revive a confirmation; a shorter one still applies at once.
  New installs get the column from `configure`. If your original migration has already run, use
  the [upgrade migration below](#upgrade-the-confirmations-table-from-011).
- Breaking: the account block now needs `throttle.requests` completed wrong passwords. Checks
  still in flight, and checks whose verifier threw, no longer count towards it. The block is kept
  under its own limiter key for exactly `blockDuration`, so a refund cannot open it and a refused
  retry cannot extend it.
- The limiter keys are derived from a SHA-256 of the account id (at most 95 characters), so a long
  string id fits the limiter's database store. Counters and blocks in place at upgrade are not
  carried over.
- `confirmPassword` copies its `CurrentAccountInput` on entry and refuses to issue for an account
  other than the one whose password it checked, so a host that refreshes that object in place
  cannot move issuance onto another sign-in.
- `configure` warns when an existing config or migration does not match the flags of a rerun. It
  still leaves both files unchanged.

- `confirmPassword` refuses an account Account Kit reports as passwordless (`hasPassword: false`)
  even when a hash is stored, as the Kit's login does. It counts as a wrong password.
- `defineConfig` rejects a `throttle.duration` or `throttle.blockDuration` that is not a duration of
  at least one second. Before, the value failed later inside the limiter, or a sub-second value
  created a counter that never expired.
- When the password verifier throws and the attempt refund also fails, `confirmPassword` rejects
  with an `AggregateError` holding both, with the verifier error as `cause`. Before, the refund
  error replaced the verifier error.

- Require Account Kit `0.4.0` exactly. The three Kit storage details this package reads are
  unchanged in 0.4.0: the coupling canary and the revocation suite pass against it.

### Upgrade the confirmations table from 0.1.1

Create a new migration in your host application with a timestamp after the original confirmations
migration. Set `tableName` to the configured `table` if you use a custom name. Run
`node ace migration:run` before deploying the 0.2.0 service.

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'password_confirmations'

  async up() {
    this.defer(async (db) => {
      await db.from(this.tableName).delete()
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.bigInteger('expires_at').notNullable().defaultTo(0)
      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['expires_at'])
      table.dropColumn('expires_at')
    })
  }
}
```

## 0.1.1 - 2026-11-10

- Require Account Kit `0.3.4` exactly. Account Kit 0.3.4 changes only its examples and tooling, so
  the three Kit storage details this package reads are unchanged.

## 0.1.0 - 2026-11-08

First release, for Account Kit 0.3.3 exactly.

- `confirmPassword()` checks the current password and issues a single-use confirmation. The hash
  runs outside the Kit account lock.
- `withConfirmation()` / `consume()` spend it inside the caller's `withCurrent` transaction, so the
  confirmation and the change commit or roll back together.
- Each confirmation is bound to the sign-in, the live credential revision, the action, the scope and
  the exact request. The window defaults to 5 minutes.
- Host `authorize` sees only action, scope and request; unsafe integers in a request are refused.
- A per-account wrong-password throttle reserves an attempt before hashing.
- `node ace configure` writes the config, the `password_confirmations` migration (or `--table`) and
  the provider. `prune()` removes spent and expired confirmations.
