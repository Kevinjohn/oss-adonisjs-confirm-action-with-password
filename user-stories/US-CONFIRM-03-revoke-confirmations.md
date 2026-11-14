# US-CONFIRM-03 — Reject confirmations after account security changes

As an account holder, I want confirmations tied to my current sign-in and credential revision so that account security changes invalidate earlier proof.

**Status:** Current; invalidation follows Account Kit lifecycle changes.
**Access:** Current registered sign-in and unchanged credential revision are required at spend. Account Kit owns session expiry, revocation and credential updates. The logout guarantee needs a server-side session store, because the cookie store keeps a copied session alive ([US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md), [README requirements](../README.md#requirements)).
**Entry:** No separate control. The host observes refusal on the next protected operation; Account Kit lifecycle operations trigger invalidation.
**Documentation:** [README confirmation lifecycle](../README.md#what-ends-a-confirmation)
**Source:** [`consume`](../src/password_confirmations.ts), [Account Kit compatibility tests](../tests/revocation.spec.ts)
**Coverage:** [`tests/revocation.spec.ts`](../tests/revocation.spec.ts)

## Acceptance criteria

- Password change/reset, logout, session revocation, restriction changes, completed email change, account deletion, expiry, and a new sign-in in the same browser end outstanding confirmations as described in README.
- Spending requires the live credential revision and same live sign-in; otherwise the service refuses before or during confirmation consumption. Recover with an eligible sign-in, then fresh password confirmation; a deleted account cannot issue new proof.
- Social unlink and registration claim share Kit invalidation paths but are called out as not directly driven by tests in the README.

## User flow

```mermaid
flowchart TD
    A["Account holder changes password or sign-in state"] --> B["Account Kit applies lifecycle change"]
    B --> C["Previously issued confirmation is no longer usable"]
    C --> D["Next sensitive request is refused"]
    D --> E{"Account can establish an eligible sign-in?"}
    E -->|Yes| F["Sign in if needed, then confirm password again"]
    E -->|No| G["Fresh confirmation unavailable"]
```

## Code flow

Scope: package service path; HTTP request validation, origin checks and response mapping remain host-owned.

```mermaid
flowchart TD
    A["Account Kit lifecycle operation"] --> B["Kit invalidates session or advances credential state"]
    B --> C{"withConfirmation calls withCurrent; live sign-in accepted?"}
    C -->|No| G["Refuse invalid or revoked sign-in before consume"]
    C -->|Yes| H["consume compares live credential revision and stored binding"]
    H --> D{"Stored binding still matches?"}
    D -->|No| E["No matching row update; required error"]
    D -->|Yes| F["Confirmation can be consumed"]
```

**Code references:** [Spend check](../src/password_confirmations.ts#L229), [revocation contract](../README.md#what-ends-a-confirmation), [revocation spec](../tests/revocation.spec.ts)
