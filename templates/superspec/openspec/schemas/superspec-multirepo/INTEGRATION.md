# Superspec Multi-Repository integration

## Required composition

Project Template `superspec` declares the bundled `superpowers` Extension as required.
During interactive init the Template is selected before Extensions; `superpowers` is
then shown selected and locked. In flag mode it is added automatically. Explicit
`--no-extensions` is rejected for this Template.

The Extension remains a standalone native Agent payload. The requirement guarantees
composition; it does not copy skills into the Template or move their ownership to Core.

## Skill handoffs

| Phase | Required handoff |
| --- | --- |
| Brainstorm | `superpowers:brainstorming` |
| Plan | `superpowers:writing-plans` |
| Apply preflight | `superpowers:using-superpowers`, repository scope and optional Change Tracking Assignments |
| Workspace | `superpowers:using-git-worktrees` per Code Repository |
| Default execution | `superpowers:subagent-driven-development`, with transitive TDD and per-task/final review |
| Fallback execution | `superpowers:executing-plans` plus explicit `test-driven-development` and `requesting-code-review` |
| Failure | `superpowers:systematic-debugging` |
| Review feedback | `superpowers:receiving-code-review` |
| Repository completion | `superpowers:verification-before-completion` plus optional Result Receipt |
| Verify | `openspec-verify-change`, current candidate evidence and external checkpoint |
| Finalize | authorized `superpowers:finishing-a-development-branch` per repository |

Independent repository work may use `superpowers:dispatching-parallel-agents` only
when plan dependencies, state and paths do not overlap. The default is to preserve the
plan's dependency order.

## Apply and Verify convergence

1. `/opsx:apply` performs repository work and writes `apply.md` iteration N.
2. `/opsx:verify` runs fresh technical checks and writes `verify.md` for iteration N.
3. Code failure invokes systematic debugging and returns to Apply iteration N+1.
4. Artifact drift returns to the owning artifact, then Apply iteration N+1.
5. A replaced repository result creates new Change Tracking evidence and candidate.
6. More than five failed iterations stop for user direction.

PASS requires every technical repository result, current Change Tracking evidence when
connected, and the final external verification checkbox completed by its named
responsible participant for the current version. Agent reasoning, tests and Snapshot
identity are necessary evidence but are not that external confirmation.

## Finalize and Archive

Finalize is not a single Store-wide Git command. It repeats the Superpowers branch
completion decision for every affected Code Repository after explicit authorization,
records pull-request/review/worktree outcomes, and routes code-changing feedback back
through Apply and Verify. The optional code-reviewer orientation is prepared from the
governed artifacts and posted only under the team's normal authorization.

Archive requires current Finalize outcomes, external verification, current Change
Tracking evidence when connected, and the actual Release gate. Neither Verify nor
Finalize alone authorizes deployment, Release or Archive.
