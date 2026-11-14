# Capability coverage

“New” means newly documented here; it does not mean newly implemented. Tests are source references and are not a claim that runtime tests ran during catalogue work.

| Story                                                     | Action                                                         | Access                                                                                    | Status   | Catalogue |
| --------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- | --------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)      | Re-enter password and issue an action-bound confirmation       | Current registered Account Kit sign-in on a server-side session store; host origin policy | Current  | New       |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)      | Consume the confirmation with the protected operation          | Same account/sign-in, matching action/scope/intent/revision                               | Current  | New       |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)    | Reject a confirmation after credential or sign-in invalidation | Account Kit lifecycle                                                                     | Current  | New       |
| [US-CONFIRM-04](US-CONFIRM-04-configure-confirmations.md) | Configure and install provider/storage                         | Application operator                                                                      | Operator | New       |
| [US-CONFIRM-05](US-CONFIRM-05-prune-confirmations.md)     | Prune spent and expired rows                                   | Application operator                                                                      | Operator | New       |

Public surface mapped: `configure`/`stubsRoot`, `defineConfig`, `PasswordConfirmations`, provider/service export, request/result/config types, error namespace and named error exports. No prior story catalogue existed; all rows are newly documented. Review findings from issue #9 were applied at baseline `2a5dd8c`: US-CONFIRM-01, 02 and 04 diagrams, criteria and anchors corrected; US-CONFIRM-05 Coverage link and window anchor corrected; US-CONFIRM-03 notes the session-store prerequisite.
