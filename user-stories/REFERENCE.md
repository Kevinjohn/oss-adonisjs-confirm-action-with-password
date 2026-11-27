# Reference

## Actors and boundaries

- **Signed-in account holder**: an application user whose current Account Kit sign-in is represented by `CurrentAccountInput`. The package supports Account Kit 0.8.0 with the session strategy with session management on a server-side session store ([README host rules](../README.md#supported-adonisjs-versions)); access-token authentication has no registered sign-in row and is refused.
- **Host application**: owns routes, request validation, same-origin/CSRF defences, UI, operation/resource naming (`operation`/`scope`), authorisation in [`authorize`](US-CONFIRM-09-register-authorization.md), the exact `intent`, and any throttle route when package throttling is disabled. The package does not provide a browser UI or endpoints.
- **Operator**: installs/configures the provider and migration, supplies host callbacks, and schedules pruning.

## Shared source map

- Public exports: [`index.ts`](../index.ts); injectable service: [`services/main.ts`](../services/main.ts).
- Configuration: [`src/define_config.ts`](../src/define_config.ts), [`src/types.ts`](../src/types.ts), [`configure.ts`](../configure.ts).
- Callback registration and dependency resolution: [authorization loader](../src/authorization.ts), [provider](../providers/password_confirmations_provider.ts).
- Issuance, spending and pruning: [`src/password_confirmations.ts`](../src/password_confirmations.ts).
- Account Kit 0.8.0 [current account and sign-in checks](https://github.com/Kevinjohn/oss-adonisjs-account-kit/blob/42e6c06929baaa01f0c4810e2b9afae2e9953d7d/src/authentication.ts#L55-L88), [transaction and post-commit handling](https://github.com/Kevinjohn/oss-adonisjs-account-kit/blob/42e6c06929baaa01f0c4810e2b9afae2e9953d7d/src/transaction.ts#L182-L199): `withCurrent` checks the live sign-in, revision and configured `canAccess`; it does not itself call `requireActive`. The host owns any additional verified-email policy.
- Account Kit session and credential invalidation integration: package contract and evidence in [README](../README.md#what-ends-a-confirmation) and [`tests/revocation.spec.ts`](../tests/revocation.spec.ts).
- User instructions: [README usage and host rules](../README.md#usage), [throttling and origin guidance](../README.md#rules-the-host-must-keep). No interactive guide or built-in route exists.

Status records source availability, not test execution. `Current` means the API can be called when the stated Account Kit and host conditions hold; tests are linked as evidence only.

## Availability definitions

- **Current:** exposed under stated account, session, configuration and host conditions; not a test result.
- **Hidden:** implementation remains but its ordinary entry or trigger is unavailable.
- **Removed:** historical capability has no current product entry.
- **Demo:** available only in a named demo context.
- **Operator:** installation, hosting, cleanup or recovery outside an ordinary application journey.
- **Planned:** an agreed target without an ordinary implemented journey.

See the portable [story template](TEMPLATE.md) for the complete writing and diagram maintenance rules.

## Operational evidence

- HTTP error negotiation and account-wide throttling are exercised by [throttle tests](../tests/throttle.spec.ts) and [shared-store host tests](../tests/host_compatibility.spec.ts).
- A previously applied migration is exercised by the [schema upgrade fixture](../tests/schema_upgrade.spec.ts).
- The [release gate](../bin/release_check.sh) runs the [installed host](../tests/fixtures/packed_consumer/host.ts) through the [consumer harness](../bin/test_packed_consumer.mjs).

## Capability inventory

- Installation, migration placement, provider resolution, configuration defaults, hash callbacks and the `windowMs` accessor map to [US-CONFIRM-04](US-CONFIRM-04-configure-confirmations.md). Direct construction uses the dependencies in [types](../src/types.ts); the provider supplies the application hash service, Kit, database and optional limiter.
- Issuing, canonical request binding, password verification and issuing-time cleanup map to [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md); spending through `withConfirmation` or `consume` maps to [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md). Account Kit lifecycle invalidation maps to [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md).
- Scheduled deletion maps to [US-CONFIRM-05](US-CONFIRM-05-prune-confirmations.md), limiter refusal and recovery to [US-CONFIRM-06](US-CONFIRM-06-recover-from-throttling.md), migration of existing storage to [US-CONFIRM-07](US-CONFIRM-07-upgrade-confirmation-storage.md), archive verification to [US-CONFIRM-08](US-CONFIRM-08-verify-release-archive.md), and registry/config policy selection to [US-CONFIRM-09](US-CONFIRM-09-register-authorization.md). Public exception exports support these actions; they are not separate user outcomes.
