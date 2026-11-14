# Reference

## Actors and boundaries

- **Signed-in account holder**: an application user whose current Account Kit sign-in is represented by `CurrentAccountInput`. The package supports Account Kit's session strategy with session management on a server-side session store ([README requirements](../README.md#requirements)); access-token authentication has no registered sign-in row and is refused.
- **Host application**: owns routes, request validation, same-origin/CSRF defenses, UI, action/scope naming, policy in `authorize`, the exact `intent`, and any throttle route when package throttling is disabled. The package does not provide a browser UI or endpoints.
- **Operator**: installs/configures the provider and migration, supplies host callbacks, and schedules pruning.

## Shared source map

- Public exports: [`index.ts`](../index.ts); injectable service: [`services/main.ts`](../services/main.ts).
- Configuration: [`src/define_config.ts`](../src/define_config.ts), [`src/types.ts`](../src/types.ts), [`configure.ts`](../configure.ts).
- Issuance, spending and pruning: [`src/password_confirmations.ts`](../src/password_confirmations.ts).
- Account Kit session and credential invalidation integration: package contract and evidence in [README](../README.md#what-ends-a-confirmation) and [`tests/revocation.spec.ts`](../tests/revocation.spec.ts).
- User instructions: [README usage and host rules](../README.md#use), [throttling and origin guidance](../README.md#rules-the-host-must-keep). No interactive guide or built-in route exists.

Status records source availability, not test execution. `Current` means the API can be called when the stated Account Kit and host conditions hold; tests are linked as evidence only.

## Availability definitions

- **Current:** exposed under stated account, session, configuration and host conditions; not a test result.
- **Hidden:** implementation remains but its ordinary entry or trigger is unavailable.
- **Removed:** historical capability has no current product entry.
- **Demo:** available only in a named demo context.
- **Operator:** installation, hosting, cleanup or recovery outside an ordinary application journey.
- **Planned:** an agreed target without an ordinary implemented journey.

See the portable [story template](TEMPLATE.md) for the complete writing and diagram maintenance rules.
