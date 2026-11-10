# Changelog

## Unreleased

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
