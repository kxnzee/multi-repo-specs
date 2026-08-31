# Feature Acceptance

**Change:** `<change-name>`

<!-- FEATURE_ACCEPTANCE_CONTRACT_V1_START -->
## Evidence

| Check or Scenario | Evidence | Result |
| --- | --- | --- |
| `<what was checked>` | `<reference or observed result without secrets>` | `PASS` / `FAIL` / `N/A` / `PENDING` |

Use `N/A` only when a check is not applicable and record the reason. An applicable
check that was not run is `PENDING`.

## Human gate

- **Decision:** `PENDING` / `PASS` / `FAIL`
- **Comment:** `<reason or evidence reference>`

The Agent prepares evidence but does not choose the gate decision. Without an explicit
human decision, keep the gate `PENDING`. `PASS` requires every applicable row to be
`PASS` or justified `N/A`. After implementation changes, collect current evidence and
obtain a new decision.

Feature Acceptance does not authorize Release or Archive.
<!-- FEATURE_ACCEPTANCE_CONTRACT_V1_END -->

## Process Compliance

`NOT_APPLICABLE` — `spec-driven-extended` does not prescribe TDD, worktrees, subagents or a specific
review workflow.

**Failures / next step:** `<details>`
