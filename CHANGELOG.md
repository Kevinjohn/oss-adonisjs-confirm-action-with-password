# Changelog

## Unreleased

- Breaking: the confirmations table has a new NOT NULL `expires_at` column holding the deadline
  returned by `confirmPassword`. Spend, issue-time cleanup and `prune()` use it, so a longer
  `window` configured later cannot revive a confirmation; a shorter one still applies at once.
  New installs get the column from `configure`. An existing install adds it with a migration:
  delete the rows (they live for the window at most), then
  `table.bigInteger('expires_at').notNullable().defaultTo(0)` and `table.index(['expires_at'])`.
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
