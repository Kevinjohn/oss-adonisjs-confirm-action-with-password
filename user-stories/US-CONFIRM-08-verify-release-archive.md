# US-CONFIRM-08 — Verify and release the candidate archive

As a package maintainer, I want to exercise the exact release archive in installed hosts so that consumers receive the bytes validated by the release gate.

**Status:** Operator.
**Access:** Release workflow dispatch on main and permission to create the prerelease.
**Entry:** Dispatch the release workflow, or exercise its package gate locally with bash bin/release_check.sh.
**Documentation:** [Package guide](../README.md)
**Source:** [Implementation](../bin/release_check.sh)
**Coverage:** [Regression evidence](../tests/tooling/release_check.spec.ts)

## Acceptance criteria

- Before packaging, the release workflow requires the `checks` job in the `checks.yml` push or manual run for the exact commit on `main` to succeed.
- An existing version tag, missing date-stamped version heading or populated Unreleased section stops the gate. After building and packing, record the archive SHA-256. A failed host run or changed digest prevents release.
- The [pin consistency test](../tests/tooling/packed_consumer_pins.spec.ts) in the workflow checks compares consumer pins with the repository lockfile. The package gate uses independent hosts to install the candidate under TypeScript 5.9.3 and 6.0.3 with strict peer installation. They verify packed exports and stubs, run configure and migrations, resolve the provider and public singleton, issue a confirmation, spend it once, reject reuse and type-check the host. [Consumer runner](../bin/test_packed_consumer.mjs) · [Host assertions](../tests/fixtures/packed_consumer/host.ts)
- The workflow transfers the checked archive and generated notes to the release job. It creates a GitHub prerelease at the workflow commit with the install URL and checksum. Running the package gate locally only prepares the files. [Release workflow](../.github/workflows/release.yml)

## User flow

```mermaid
flowchart TD
    A["Dispatch release workflow or run local gate"] --> B{"Validation succeeds?"}
    B -->|No| C["Inspect failure; correct candidate before retrying"]
    C --> A
    B -->|Yes| D{"Workflow or local gate?"}
    D -->|Workflow| E["Receive published prerelease or inspect publication failure"]
    D -->|Local| F["Obtain checked archive and notes with digest; no release"]
```

## Code flow

Scope: release workflow and common local package gate.

```mermaid
flowchart TD
    A["Workflow dispatch"] --> B{"Exact commit on main has successful checks.yml evidence?"}
    B -->|No| X["Stop; no publication"]
    B -->|Yes| C{"release_check.sh: tag and changelog valid?"}
    L["Local bash bin/release_check.sh"] --> C
    C -->|No| X
    C -->|Yes| P{"Build, pack candidate and calculate valid SHA-256 succeed?"}
    P -->|No| X
    P -->|Yes| G{"Both installed consumer runs succeed?"}
    G -->|No| X
    G -->|Yes| H{"Archive digest unchanged?"}
    H -->|No| X
    H -->|Yes| N["Generate release notes and install URL with digest"]
    N --> T{"Running within workflow?"}
    T -->|No| O["Local files ready; no publication"]
    T -->|Yes| U{"Upload release artifact; release job downloads successfully?"}
    U -->|No| X
    U -->|Yes| R["gh release create as prerelease at workflow commit"]
```

**Code references:** [Implementation](../bin/release_check.sh), [regression evidence](../tests/tooling/release_check.spec.ts).
