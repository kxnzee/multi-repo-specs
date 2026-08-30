# Finalize Receipt

> Records authorized closeout for every affected Code Repository after Verify. It does
> not itself authorize deployment, Release or Archive.

**Change:** `<change-name>`

**Finalized at:** `YYYY-MM-DD HH:mm`

**Apply iteration:** `<verified iteration>`
**Candidate Snapshot:** `<verified identity or N/A>`

## Repository outcomes

| Repository ID | Authorized by | Choice | Branch / worktree disposition | PR / review state | Result |
| --- | --- | --- | --- | --- | --- |
| `<repository-id>` | `<participant or accepted gate>` | `integrate-locally` / `pull-request` / `keep` / `discard` | `<state>` | `<URL/status or N/A>` | `complete` / `pending` / `failed` |

## Code-reviewer orientation

- **PR mutation authorized:** `yes` / `no` / `N/A`
- **Orientation:** `posted` / `updated` / `skipped` / `failed: <reason>`
- **Reviewer reading order:** Proposal → Specs → optional Design → code diff → Verify

## Retrospective

- **Wins:**
- **Misses:**
- **Plan deviations:**
- **Skill/workflow compliance:**
- **Surprises:**
- **Promotion candidates:**

## Unresolved work

<!-- Review feedback, preserved worktrees, pending PRs or repository outcomes. -->

## Release and Archive gates

- **External verification:** `<participant, current version and confirmation>`
- **Release gate:** `pending` / `<accepted evidence>`
- **Archive eligibility:** `blocked` / `ready after Release`
- **Next step:** `<exact team-owned action>`
