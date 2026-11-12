# Capability coverage

“New” means newly documented here; it does not mean newly implemented. Tests are source references and are not a claim that runtime tests ran during catalogue work.

| Story                                                   | Action                                                         | Access                                                      | Status   | Catalogue |
| ------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- | -------- | --------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)    | Re-enter password and issue an action-bound confirmation       | Current registered Account Kit sign-in; host origin policy  | Current  | New       |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)    | Consume the confirmation with the protected operation          | Same account/sign-in, matching action/scope/intent/revision | Current  | New       |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)  | Refuse a confirmation after credential or sign-in invalidation | Account Kit lifecycle                                       | Current  | New       |
| [US-CONFIRM-04](US-CONFIRM-04-operate-confirmations.md) | Install storage and prune old rows                             | Application operator                                        | Operator | New       |

Public surface mapped: `configure`/`stubsRoot`, `defineConfig`, `PasswordConfirmations`, provider/service export, request/result/config types, error namespace and named error exports. No prior story catalogue existed; all rows are newly documented.
