# US-CONFIRM-07 — Upgrade existing confirmation storage

As a host operator, I want to upgrade an already migrated 0.1.1 table so that the service can enforce a stored deadline for every new confirmation.

**Status:** Operator.
**Access:** An existing host has already applied the 0.1.1 create migration.
**Entry:** Run a new host migration before deploying the service that reads expires_at.
**Documentation:** [Package guide](../README.md)
**Source:** [Implementation](../CHANGELOG.md)
**Coverage:** [Regression evidence](../tests/schema_upgrade.spec.ts)

## Acceptance criteria

- Create a later migration from the changelog upgrade example, using the configured table name. Re-running configure preserves the original migration and cannot upgrade a table that Lucid already records as migrated.
- Run `node ace migration:run`. The migration removes existing proofs and adds a non-null indexed `expires_at` with default zero. Account holders must confirm again. The down migration drops the index and column. It cannot restore deleted proofs.

## User flow

```mermaid
flowchart TD
    A["Prepare the host upgrade migration"] --> B["Apply it before deploying"]
    B --> C["Require fresh proof"]
```

## Code flow

```mermaid
flowchart TD
    A["Lucid runs the later migration"] --> B["Clear earlier confirmations"]
    B --> C["Persist indexed expires_at"]
```

**Code references:** [Implementation](../CHANGELOG.md), [regression evidence](../tests/schema_upgrade.spec.ts).
