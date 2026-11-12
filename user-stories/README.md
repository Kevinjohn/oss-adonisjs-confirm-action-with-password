# User story catalogue

Source baseline: `d76251788f62f41bcbe3732f382ba72ff48f1446` (origin/main, 2026-11-12). Scope: public package API, configuration and provider setup, issuance and spending, credential/session invalidation, throttling, and operator pruning. Source-reviewed only; no runtime journeys were exercised for this catalogue.

## Index

| Story                                                   | Action                                                                      | Status   |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [US-CONFIRM-01](US-CONFIRM-01-issue-confirmation.md)    | Issue a confirmation after re-entering the password                         | Current  |
| [US-CONFIRM-02](US-CONFIRM-02-spend-confirmation.md)    | Spend a confirmation with the sensitive change                              | Current  |
| [US-CONFIRM-03](US-CONFIRM-03-revoke-confirmations.md)  | Invalidate a confirmation when account credentials or sign-in state changes | Current  |
| [US-CONFIRM-04](US-CONFIRM-04-operate-confirmations.md) | Configure storage and remove spent or expired confirmations                 | Operator |

## Files

- [Template and maintenance rules](TEMPLATE.md)
- [Roles, interfaces and source map](REFERENCE.md)
- [Capability coverage](COVERAGE.md)
- [Decision gaps](GAPS.md)
