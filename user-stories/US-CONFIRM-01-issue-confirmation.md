# US-CONFIRM-01 — Issue a confirmation after re-entering the password

As a signed-in account holder, I want to confirm my password for a named sensitive operation so that the application can require recent proof before it changes important data.

**Status:** Current, for a current Account Kit session with session management enabled.
**Access:** Account Kit session sign-in with a server-side session store (the cookie store keeps a copied session alive after sign-out, so the sign-out guarantee in [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md) needs a server-side store; [README host rules](../README.md#supported-adonisjs-versions)); access tokens are refused because they have no sign-in row. Kit also applies its configured `canAccess` policy; this path does not independently require verified email. The host must reject foreign-origin issuance requests before invoking the service.
**Entry:** Host-owned issuance endpoint calls `passwordConfirmations.confirmPassword(input, request)`; the package has no HTTP control.
**Documentation:** [README usage and host requirements](../README.md#usage)
**Source:** [`PasswordConfirmations.confirmPassword`](../src/password_confirmations.ts)
**Coverage:** [`tests/password_confirmations.spec.ts`](../tests/password_confirmations.spec.ts)

## Acceptance criteria

- The host supplies the operation name (`operation`) and resource key (`scope`) as strings of 1–255 characters, a required intent made only of plain JSON values (finite numbers and safe integers; hashed inside an `{action, scope, intent}` wrapper, so it may nest at most 31 container levels around a value, and a value at depth 33 or deeper is refused), and the password string. These are API inputs, not package-rendered form fields.
- When configured, the [host authorisation callback](US-CONFIRM-09-register-authorization.md) runs before password verification and again before issue; anything other than literal `true` refuses. It receives the Kit context and only `{ operation, scope, intent }`, never the password. The proof is bound to the operation, not a permission grant; keep the intent unchanged after the call starts.
- If Account Kit reports `E_ACCOUNT_KIT_POST_COMMIT` while taking the stage-one snapshot, issuance stops before verification. If issuance committed and then reports this error, the host has no ID to return. Ask for a fresh confirmation and let the orphan expire. [README errors](../README.md#errors)
- A correct password returns `confirmationId` and `expiresAt`; malformed/wrong password, stale verification, missing sign-in registry, refusal or exhausted throttle returns an error and issues nothing.
- Default failed-attempt budget is 5 per account per minute, then a 20-minute block; `throttle: false` requires host throttling reserved before hash verification.

- The service snapshots the current account input before either Kit transaction. A passwordless account, missing hash or non-string password follows the wrong-password path. The verifier runs outside the transaction. A successful check starts the window before limiter cleanup, then the service reacquires the same account, checks permission again and persists the deadline. The returned `expiresAt` is epoch milliseconds.
- Only the JSON projection contributes to the intent hash. Object keys sort by UTF-16 code units and array order matters. Unsupported values, sparse arrays, unsafe integers and nesting beyond depth 32 are refused. Negative zero hashes as zero. Use strings for identifiers outside the safe integer range. [Binding rules and edge cases](../tests/intent_hash.spec.ts)

## User flow

```mermaid
flowchart TD
    A["Host receives a password-confirmation request for an operation"] --> B["Host validates account-holder input"]
    B --> C{"Input and host origin check pass?"}
    C -->|No| D["Host rejects request; no service call"]
    C -->|Yes| E["Host calls confirmPassword"]
    E --> F{"Password and authorisation accepted?"}
    F -->|No| G["Host maps refusal or error"]
    F -->|Yes| H["Host receives short-lived confirmation ID"]
```

## Code flow

Scope: package service path; HTTP request validation, origin checks and response mapping remain host-owned.

```mermaid
flowchart TD
    A["confirmPassword(input, request); snapshotCurrentAccount"] --> B{"buildConfirmationBinding accepts request?"}
    B -->|No| X["Binding or account/permission failure; no proof"]
    B -->|Yes| C{"withCurrent stage 1 accepts current account, registered sign-in and authorize?"}
    C -->|No| X
    C -->|Yes| S["Read password hash if account has password"]
    S --> S1{"Snapshot transaction outcome?"}
    S1 -->|Pre-commit failure| X
    S1 -->|Committed with follow-up error| X1["Propagate Kit error before verification"]
    S1 -->|Success| T{"Package throttle on?"}
    T -->|"No (throttle: false; host throttles in its own route)"| E["Check password outside Kit transaction when string and hash are present"]
    T -->|Yes| D{"reserveAttempt: block and budget allow?"}
    D -->|No| D2["Throttle refusal (429) or limiter fault; no hash run, no row issued"]
    D -->|Yes| E
    E --> F{"Verification outcome?"}
    F -->|Wrong, non-string or no hash| G["Record completed failure if throttled; deny; no row"]
    F -->|Verifier throws| V["Refund reservation if throttled; rethrow (AggregateError if refund fails)"]
    F -->|Correct| W["Read verifiedAt; reset attempt and failure counts if throttled"]
    W --> H{"withCurrent stage 2 accepts same account, current sign-in and authorize?"}
    H -->|No| X
    H -->|Yes| I{"issuedAt before verifiedAt + windowMs?"}
    I -->|No| J["E_PASSWORD_CONFIRMATION_STALE; no row issued"]
    I -->|Yes| K["Read live revision; delete this sign-in's spent/expired rows; insert and return id/expiry from callback"]
    K --> Q{"Account Kit transaction outcome?"}
    Q -->|Pre-commit failure| X
    Q -->|Committed with follow-up error| O["Propagate Kit error; issued proof expires without delivered ID"]
    Q -->|Success| Z["Return confirmation ID and expiry to caller"]
```

**Code references:** [Entry/service and attempt reservation](../src/password_confirmations.ts), [request binding](../src/intent_hash.ts), [return and config types](../src/types.ts)
