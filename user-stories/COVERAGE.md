# Capability coverage

Indexed by user outcome. Linked stories identify the service methods, host responsibilities and test evidence for each path. New marks a story added in this refresh.

| Story                                                          | Operation                                                      | Access                                                                                   | Status   | Catalogue |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- | --------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)           | Re-enter password and issue an operation-bound confirmation    | Current registered Account Kit sign-in on a server-side session store; host origin rules | Current  | Reviewed  |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)           | Consume the confirmation with the protected operation          | Same account/sign-in, matching `action`/`scope`/`intent`/revision                        | Current  | Reviewed  |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)         | Reject a confirmation after credential or sign-in invalidation | Account Kit lifecycle                                                                    | Current  | Reviewed  |
| [US-CONFIRM-04](US-CONFIRM-04-configure-confirmations.md)      | Configure and install provider/storage                         | Application operator                                                                     | Operator | Reviewed  |
| [US-CONFIRM-05](US-CONFIRM-05-prune-confirmations.md)          | Prune spent and expired rows                                   | Application operator                                                                     | Operator | Reviewed  |
| [US-CONFIRM-06](US-CONFIRM-06-recover-from-throttling.md)      | Recover from password-check throttling                         | The host uses the package limiter and exposes an exception handler.                      | Current  | Reviewed  |
| [US-CONFIRM-07](US-CONFIRM-07-upgrade-confirmation-storage.md) | Upgrade existing confirmation storage                          | An existing host has already applied the 0.1.1 create migration.                         | Operator | Reviewed  |
| [US-CONFIRM-08](US-CONFIRM-08-verify-release-archive.md)       | Verify and release the candidate archive                       | Release workflow dispatch on main and permission to create the prerelease.               | Operator | Reviewed  |
| [US-CONFIRM-09](US-CONFIRM-09-register-authorization.md)       | Configure operation authorisation                              | Host developer who controls package config or provider boot                              | Operator | New       |
