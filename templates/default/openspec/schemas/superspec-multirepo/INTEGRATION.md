# Superspec Multi-Repository integration

## Required composition

Project Template `default` declares both `spec-driven-extended` and `superpowers` Extensions
as required and installs this schema beside `spec-driven-extended`. During interactive init both
Extensions are shown selected and locked; flag mode adds them automatically. Explicit
`--no-extensions` is rejected for this Template. A Change selects this schema with
`openspec new change <change-id> --schema superspec-multirepo`.

The Extension remains a standalone native Agent payload. The requirement guarantees
composition; it does not copy skills into the Template or move their ownership to Core.

## Skill handoffs

| Phase | Required handoff |
| --- | --- |
| Brainstorm | `superpowers:brainstorming` |
| Plan | `superpowers:writing-plans` |
| Apply preflight | `superpowers:using-superpowers` and accepted repository scope |
| Workspace | `superpowers:using-git-worktrees` per Code Repository |
| Default execution | `superpowers:subagent-driven-development`, with transitive TDD and per-task/final review |
| Fallback execution | `superpowers:executing-plans` plus explicit `test-driven-development` and `requesting-code-review` |
| Failure | `superpowers:systematic-debugging` |
| Review feedback | `superpowers:receiving-code-review` |
| Repository completion | `superpowers:verification-before-completion` with exact commit evidence |
| Verify | `openspec-verify-change`, evidence and human Feature Acceptance |

Independent repository work may use `superpowers:dispatching-parallel-agents` only
when plan dependencies, state and paths do not overlap. The default is to preserve the
plan's dependency order.

## Apply and Verify convergence

1. `/opsx:apply` performs repository work, updates only completed Tasks and returns a
   concise execution summary without creating a separate receipt artifact.
2. The next schema artifact invokes `openspec-verify-change`, runs fresh technical
   checks and writes `verify.md` for the current candidate.
3. Code failure invokes systematic debugging and returns to Apply.
4. Artifact drift returns to the owning artifact, then Apply.
5. Implementation changes require current evidence and a new human decision.

Feature Acceptance remains `PENDING` until a person explicitly selects `PASS` or
`FAIL` from the collected evidence. It is exactly the same universal contract
used by `spec-driven-extended`. Agent reasoning and technical checks prepare evidence
but cannot make the human decision. Superspec Process Compliance is evaluated
separately and cannot weaken Feature Acceptance.

The standalone `/opsx:verify` surface returns the upstream verification report but
does not persist a schema artifact. Use the schema artifact flow when the governed
`verify.md` gate must be recorded after implementation.

## Closeout and Archive

A person explicitly invokes any required branch, review or PR command after Feature
Acceptance. `superpowers:finishing-a-development-branch` remains available, but the
schema does not call it or persist a separate closeout receipt.

Archive requires human Feature Acceptance, Superspec Process Compliance and the
actual Release gate. Verify alone does not authorize deployment, Release or Archive.
