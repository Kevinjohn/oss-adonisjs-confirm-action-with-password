# US-CONFIRM-02 — Spend a confirmation with the sensitive change

As a signed-in account holder, I want the application to spend my confirmation with the exact operation it authorized so that the proof cannot authorize a different change or be reused.

**Status:** Current, through the same Account Kit `withCurrent` transaction.
**Access:** The confirmation must belong to the current account and sign-in and match action, scope, canonical intent hash, live credential revision, and expiry. Host policy is rerun.
**Entry:** Host protected action calls `withConfirmation(input, request, run)`, or calls `consume(context, request)` inside its own `withCurrent` callback.
**Documentation:** [README use](../README.md#use)
**Source:** [`withConfirmation` and `consume`](../src/password_confirmations.ts)
**Coverage:** [`tests/password_confirmations.spec.ts`](../tests/password_confirmations.spec.ts)

## Acceptance criteria

- The host sends the returned ID together with the same action, scope and intent. There is no package form or route.
- A matching live confirmation is marked consumed before `run`; the mark and host change share the Kit transaction.
- A missing, expired, consumed, mismatched, revoked or unauthorized confirmation is rejected; rollback of `run` also rolls back the spend.

## User flow

```mermaid
flowchart TD
    A["Host receives sensitive request and confirmation ID"] --> B["Host validates request and enters Account Kit current transaction"]
    B --> C{"Confirmation accepted?"}
    C -->|No| D["Host returns mapped refusal; change does not run"]
    C -->|Yes| E["Sensitive change runs"]
    E --> F{"Transaction commits?"}
    F -->|No| G["Change and spend roll back"]
    F -->|Yes| H["Change commits; confirmation cannot be reused"]
```

## Code flow

Scope: package service path; HTTP request validation, origin checks and response mapping remain host-owned.

```mermaid
flowchart TD
    A["withConfirmation(input, request, run)"] --> B["authentication.withCurrent"]
    B --> C["consume: sign-in + authorize + live credential revision"]
    C --> D{"exact row update count is 1?"}
    D -->|No| E["PasswordConfirmationRequiredException"]
    D -->|Yes| F["run(context) in same trx"]
    F --> G["Kit transaction commits or rolls back spend and change"]
```

**Code references:** [Methods](../src/password_confirmations.ts#L226), [transaction context types](../src/types.ts#L10)
