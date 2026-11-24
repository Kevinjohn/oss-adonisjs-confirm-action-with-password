# US-CONFIRM-09 — Configure operation authorisation

As a host application developer, I want to provide the service with an authorization callback so that it checks permission for the operation at issuance and spend.

**Status:** Operator.
**Access:** Host developer who controls package config or provider boot. Provider registration requires access to the AdonisJS container before the service is first resolved.
**Entry:** Set `authorize` in `config/password_confirmations.ts` or call `register(factory)` on the `password_confirmations.callbacks` container binding in a host provider's `boot()`.
**Documentation:** [Registering callbacks from a provider](../README.md#registering-callbacks-from-a-provider).
**Source:** [Registry](../src/callback_registry.ts), [provider](../providers/password_confirmations_provider.ts).
**Coverage:** [Registry integration tests](../tests/callback_registry.spec.ts).

## Acceptance criteria

- The generated config includes `authorize: async () => true`. Remove that setting to supply the authorization callback via the registry. Configure preserves an existing config on reruns.
- `register(factory)` takes one zero-argument factory that returns `{ authorize? }` synchronously or through a promise. List the host provider before any provider whose `boot()` resolves `PasswordConfirmations`. The registry rejects a second registration and rejects registration after resolution begins. The provider calls the factory at first service resolution and the registry caches that promise, including any rejection.
- The provider treats an omitted registry `authorize` or a `null` value from untyped code as absent. Service resolution fails with `E_PASSWORD_CONFIRMATION_INVALID_CONFIG` if the registry supplies a non-null, non-undefined value that is not a function or if both sources supply a callback. The service allows the permission check by default when neither source provides a callback.
- The authorization callback receives `KitContext` and `{ action, scope, intent }`. It runs in the Kit transaction at both issuance stages and during spend. Only literal `true` permits the operation. Use the supplied transaction for reads, leave the intent unchanged and keep the callback safe to rerun.

## User flow

```mermaid
flowchart TD
    A["Choose where to supply the operation policy"] --> B{"Load policy from config or a host provider?"}
    B -->|Config| C["Set authorize in the package config"]
    B -->|Provider| D["Remove generated authorize and register factory before service use"]
    C --> E{"Service resolves with the chosen policy?"}
    D --> E
    E -->|Configuration or factory error| F["Correct registration, provider order or callback and restart"]
    F --> A
    E -->|Yes| G["Service uses the callback when issuing or spending, or allows by default if absent"]
```

## Code flow

Scope: callback registration and provider merge. Issuance and spending call the resulting policy as traced in [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md#code-flow) and [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md#code-flow).

```mermaid
flowchart TD
    A["PasswordConfirmationsProvider.register binds registry and service singletons"] --> B{"Host provider supplies a factory?"}
    B -->|Yes| C["Host boot resolves password_confirmations.callbacks; calls register"]
    C -->|Second or late registration| X["Throw InvalidPasswordConfirmationsConfigException"]
    C -->|Accepted| D["Store factory"]
    D --> E["First PasswordConfirmations resolution checks config.windowMs"]
    B -->|No| E
    E -->|Missing| X
    E -->|Present| F["Registry.resolve runs and caches optional factory"]
    F -->|Factory rejects| Y["Propagate factory error"]
    F -->|Resolves| G{"Check registry authorize, treating null and undefined as absent"}
    G -->|Non-function value other than null or undefined, or callbacks in both sources| X
    G -->|Valid registry callback or absent| H["Resolve dependencies; construct service with config.authorize or registry callback"]
    H -->|Dependency or construction error| Z["Service resolution rejects"]
    H -->|Success| I["Return PasswordConfirmations for issuance and spending"]
```

**Code references:** [Provider merge](../providers/password_confirmations_provider.ts#L32), [registry](../src/callback_registry.ts#L20), [config stub](../stubs/config/password_confirmations.stub), [permission check](../src/password_confirmations.ts#L93).
