# Verification Report

**Change:** `<change-name>`
**Verified at:** `YYYY-MM-DD HH:mm`
**Verifier:** `<agent and responsible participant where applicable>`

<!-- CANDIDATE_VERIFICATION_CONTRACT_V1_START -->
## Candidate Verification Contract v1

### 1. Candidate identity

- **Repository commits:** `<exact repository ID and commit for every affected repository>`
- **Build / image / artifact:** `<exact identity or justified N/A>`
- **Target environment / deployment:** `<exact identity>`
- **Candidate is current and internally consistent:** `yes` / `no`

### 2. Mandatory evidence

- [ ] Current OpenSpec validation passes.
- [ ] Fresh required test, lint and build checks pass in every affected repository.
- [ ] Every accepted Scenario ID has a recorded result in the target environment.
- [ ] Candidate evidence refers to the exact commits, artifact and deployment above.

| Repository / Scenario | Fresh check or target result | Evidence | Result |
| --- | --- | --- | --- |
| `<repository-id or scenario-id>` | `<command or observed result>` | `<reference without secrets>` | `PASS` / `FAIL` |

### 3. Blocking defects

- **Open blocking defects:** `<none or list>`
- **Resolved defects rechecked against this candidate:** `yes` / `no` / `N/A`

### 4. External confirmation

- **Responsible participant:** `<name or pending>`
- **Confirmation for the exact target version:** `confirmed` / `pending` / `failed`
- **Evidence:** `<reference without secrets>`

Agent reasoning, local checks and an earlier deployment cannot substitute for the
responsible participant's confirmation of the exact current candidate.

### 5. Candidate Acceptance

- [ ] `PASS` — every mandatory criterion above is satisfied for the exact current candidate.
- [ ] `FAIL` — at least one criterion is missing, failed, stale or inconsistent.

Select exactly one decision. A new repository commit, build artifact or deployment
invalidates this result and requires a new Verify. Candidate Acceptance does not
authorize Release or Archive.
<!-- CANDIDATE_VERIFICATION_CONTRACT_V1_END -->

## Process Compliance

`NOT_APPLICABLE` — Base does not prescribe TDD, worktrees, subagents or a specific
review workflow.

**Failures / next step:** `<details>`
