# User story catalogue

Source baseline: `2a5dd8cf07c4869bd4c2d3bf1d310597d452239d` (origin/main, 2026-11-14). Scope: public package API, configuration and provider setup, issuance and spending, credential/session invalidation, throttling, and operator pruning. Source-reviewed only; no runtime journeys were exercised for this catalogue.

## Index

| Story                                                     | Action                                              | Status   |
| --------------------------------------------------------- | --------------------------------------------------- | -------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)      | Issue a confirmation after re-entering the password | Current  |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)      | Spend a confirmation with the sensitive change      | Current  |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)    | Reject confirmations after account security changes | Current  |
| [US-CONFIRM-04](US-CONFIRM-04-configure-confirmations.md) | Configure confirmation storage and provider         | Operator |
| [US-CONFIRM-05](US-CONFIRM-05-prune-confirmations.md)     | Remove spent or expired confirmations               | Operator |

## Files

- [Template and maintenance rules](TEMPLATE.md)
- [Roles, interfaces and source map](REFERENCE.md)
- [Capability coverage](COVERAGE.md)
- [Decision gaps](GAPS.md)
