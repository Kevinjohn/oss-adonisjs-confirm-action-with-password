# US-CONFIRM-02 — Spend a confirmation with the sensitive change

As a signed-in account holder, I want the application to spend my confirmation with the exact operation it is bound to so that the proof cannot be reused or spent with a different change.

**Status:** Current, through the same Account Kit `withCurrent` transaction.
**Access:** A server-side session store is required (see [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)). The confirmation must belong to the current account and sign-in and match `action`, `scope`, canonical intent hash, live credential revision, and expiry. The host authorisation callback runs again; access to the resource is a host responsibility.
**Entry:** Host protected operation calls `withConfirmation(input, request, run)`, or calls `consume(context, request)` inside its own `withCurrent` callback.
**Documentation:** [README use](../README.md#use)
**Source:** [`withConfirmation` and `consume`](../src/password_confirmations.ts)
**Coverage:** [`tests/password_confirmations.spec.ts`](../tests/password_confirmations.spec.ts)

## Acceptance criteria

- The host sends a non-empty confirmation ID and the same 1–255 character `action`/`scope` strings plus the required canonicalisable JSON intent. There is no package form or route.
- A matching live confirmation is marked consumed before `run`; the mark and host change share the Kit transaction.
- A missing, expired, consumed, mismatched or revoked confirmation is rejected; rollback of `run` also rolls back the spend. A request that fails binding (invalid `action`, `scope` or `intent`, 400), has no registered sign-in, or fails host authorisation is refused before any row is updated.

- Both deadlines apply strictly. A larger configured window cannot extend the issued deadline and a shorter one applies immediately. Equality with either deadline refuses the spend. One conditional update must affect exactly one row, so competing callers cannot commit the same proof twice. `withConfirmation` returns the callback result and `consume` resolves without a value. The callback must write through `context.trx` for its changes to roll back with the spend.

## User flow

```mermaid
flowchart TD
    A["Host receives sensitive request and confirmation ID"] --> B{"Host request validation passes?"}
    B -->|No| D
    B -->|Yes| B2["Enter Account Kit current transaction"]
    B2 --> C{"Confirmation accepted?"}
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
    A["withConfirmation(input, request, run)"] --> B{"authentication.withCurrent accepts snapshotted input?"}
    B -->|No| X["Kit refusal before consume"]
    B -->|Yes| C{"consume: sign-in registered, request binds, authorize allows?"}
    A2["Caller already inside withCurrent calls consume(context, request)"] --> C
    C -->|No| C2["SessionRegistryRequiredException, InvalidPasswordConfirmationRequestException (400) or PasswordConfirmationForbiddenException; no update"]
    C -->|Yes| C3{"Non-empty string ID?"}
    C3 -->|No| E
    C3 -->|Yes| U["Read time and live credential revision; conditional update"]
    U --> D{"exact row update count is 1?"}
    D -->|No| E["PasswordConfirmationRequiredException"]
    D -->|Yes| R{"Entry path?"}
    R -->|withConfirmation| F["run(context) in same trx"]
    R -->|consume| Y["Return to caller's callback; caller owns remaining writes"]
    Y --> G
    F --> G["Kit transaction commits or rolls back spend and change"]
```

**Code references:** [Methods](../src/password_confirmations.ts), [transaction context types](../src/types.ts)
