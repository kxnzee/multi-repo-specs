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

- **Responsible participant:** `<name>`
- **Decision:** `PENDING` / `PASS` / `FAIL`
- **Comment:** `<reason or evidence reference>`

The Agent prepares evidence but does not choose the gate decision. Without an explicit
human decision, keep the gate `PENDING`. `PASS` requires every applicable row to be
`PASS` or justified `N/A`. After implementation changes, collect current evidence and
obtain a new decision.

Feature Acceptance does not authorize Release or Archive.
<!-- FEATURE_ACCEPTANCE_CONTRACT_V1_END -->

## Superspec Process Compliance

| Check | Evidence / warning | Result |
| --- | --- | --- |
| Delta Specs sync and Design/Specs coherence | `<evidence>` | `PASS` / `WARN` / `FAIL` |
| Clean implementation state | `<evidence>` | `PASS` / `FAIL` |
| RED → GREEN TDD evidence | `<evidence>` | `PASS` / `WARN` / `FAIL` |
| Task reviews and final review | `<evidence>` | `PASS` / `WARN` / `FAIL` |
| Required Superpowers workflow | `<evidence>` | `PASS` / `WARN` / `FAIL` |

- [ ] `PASS`
- [ ] `PASS_WITH_WARNINGS`
- [ ] `FAIL`

**Warnings / failures:** `<details>`
