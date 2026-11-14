# US-CONFIRM-01 — Issue a confirmation after re-entering the password

As a signed-in account holder, I want to confirm my password for a named sensitive action so that the application can require recent proof before it changes important data.

**Status:** Current, for a current Account Kit session with session management enabled.
**Access:** Account Kit session sign-in with a server-side session store (the cookie store keeps a copied session alive after logout, so the logout guarantee in [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md) needs a server-side store; [README requirements](../README.md#requirements)); access tokens are refused because they have no sign-in row. Host must reject foreign-origin issuance requests before invoking the service.
**Entry:** Host-owned issuance endpoint calls `passwordConfirmations.confirmPassword(input, request)`; the package has no HTTP control.
**Documentation:** [README usage and host requirements](../README.md#use)
**Source:** [`PasswordConfirmations.confirmPassword`](../src/password_confirmations.ts)
**Coverage:** [`tests/password_confirmations.spec.ts`](../tests/password_confirmations.spec.ts)

## Acceptance criteria

- The host supplies action and scope strings of 1–255 characters, a required intent made only of plain JSON values (finite numbers and safe integers; hashed inside an `{action, scope, intent}` wrapper, so it may nest at most 31 container levels around a value, and a value at depth 33 or deeper is refused), and the password string. These are API inputs, not package-rendered form fields.
- Authorization runs before password verification and again before issue; a false policy rejects.
- A correct password returns `confirmationId` and `expiresAt`; malformed/wrong password, stale verification, missing sign-in registry, refusal or exhausted throttle returns an error and issues nothing.
- Default failed-attempt budget is 5 per account per minute, then a 20-minute block; `throttle: false` requires host throttling reserved before hash verification.

## User flow

```mermaid
flowchart TD
    A["Host receives a password-confirmation request for an action"] --> B["Host validates account-holder input"]
    B --> C{"Host origin check passes?"}
    C -->|No| D["Host rejects request; no service call"]
    C -->|Yes| E["Host calls confirmPassword"]
    E --> F{"Password and policy accepted?"}
    F -->|No| G["Host maps refusal or error"]
    F -->|Yes| H["Host receives short-lived confirmation ID"]
```

## Code flow

Scope: package service path; HTTP request validation, origin checks and response mapping remain host-owned.

```mermaid
flowchart TD
    A["confirmPassword(input, request)"] --> B["bindRequest(action, scope, intent)"]
    B --> C["withCurrent stage 1; authorize; read hash"]
    C --> D{"Attempt reserved? (host reservation required when throttle is off)"}
    D -->|No| D2["PasswordConfirmationThrottledException (429); no hash run, no row issued"]
    D -->|Yes| E["verify hash outside Kit transaction"]
    E --> F{"Correct password?"}
    F -->|No| G["PasswordConfirmationDeniedException; block armed when budget spent; no row issued"]
    F -->|Yes| H["withCurrent stage 2; reauthorize and recheck sign-in/revision"]
    H --> I{"Window still open?"}
    I -->|No| J["PasswordConfirmationStaleException; no row issued"]
    I -->|Yes| K["delete this sign-in's spent/expired rows, insert confirmation row, return id/expiry"]
```

**Code references:** [Entry/service](../src/password_confirmations.ts#L149), [attempt reservation](../src/password_confirmations.ts#L165), [request binding](../src/intent_hash.ts), [return type](../src/types.ts#L40), [config](../src/types.ts#L53)
