# Apply Receipt

> Overwritten after every Apply iteration. This receipt makes Verify reachable; it does
> not claim that verification passed.

**Change:** `<change-name>`

**Iteration:** `1`

**Applied at:** `YYYY-MM-DD HH:mm`
**Coordinator:** `<agent or participant>`

## Repository results

| Repository ID | Worktree | Branch | Executor | Commit | State |
| --- | --- | --- | --- | --- | --- |
| `<repository-id>` | `<path>` | `<branch>` | `subagent-driven-development` / `executing-plans` | `<sha or pending>` | `complete` / `incomplete` |

## Superpowers execution evidence

| Repository ID | TDD evidence | Task reviews | Final review | Fresh verification |
| --- | --- | --- | --- | --- |
| `<repository-id>` | `<RED/GREEN commands and result>` | `<review references>` | `<outcome>` | `<command and result>` |

## Tasks

- **Completed:** `X of Y`
- **Remaining:** `<task IDs or none>`
- **External verification:** `pending participant` / `<participant and current version>`

## Deviations and failures

<!-- Plan deviations, systematic-debugging findings and unresolved review feedback. -->

## Next step

`Run /opsx:verify` or `<required Apply correction>`.
