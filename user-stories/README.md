# User story catalogue

Reviewed against `b3bafc464a6a9e3fa8a18cd2da6766cf9b0843cd` (0.3.2); a story changed since then was updated with the code it describes. The catalogue covers account-holder, host and release-maintainer journeys. Test links identify executable evidence.

## Index

| Story                                                          | Operation                                           | Status   |
| -------------------------------------------------------------- | --------------------------------------------------- | -------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)           | Issue a confirmation after re-entering the password | Current  |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)           | Spend a confirmation with the sensitive change      | Current  |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)         | Reject confirmations after account security changes | Current  |
| [US-CONFIRM-04](US-CONFIRM-04-configure-confirmations.md)      | Configure confirmation storage and provider         | Operator |
| [US-CONFIRM-05](US-CONFIRM-05-prune-confirmations.md)          | Remove spent or expired confirmations               | Operator |
| [US-CONFIRM-06](US-CONFIRM-06-recover-from-throttling.md)      | Recover from password-check throttling              | Current  |
| [US-CONFIRM-07](US-CONFIRM-07-upgrade-confirmation-storage.md) | Upgrade existing confirmation storage               | Operator |
| [US-CONFIRM-08](US-CONFIRM-08-verify-release-archive.md)       | Verify and release the candidate archive            | Operator |

## Files

- [Template and maintenance rules](TEMPLATE.md)
- [Roles, interfaces and source map](REFERENCE.md)
- [Capability coverage](COVERAGE.md)
- [Decision gaps](GAPS.md)
