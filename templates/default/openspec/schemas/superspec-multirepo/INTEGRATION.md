# Superspec Multi-Repository integration

## Required composition

This schema requires the Superpowers Extension. The selected Project Template's
`requires.extensions` declares its required composition; consult that descriptor
and the current project configuration rather than inferring other installed schemas.
Select this schema with `openspec new change <change-id> --schema superspec-multirepo`.

The Extension owns the native Agent payload; the Template owns this schema.

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

1. `/opsx:apply` (Claude) or `/opsx-apply` (Qwen/GigaCode) performs repository work,
   updates only completed Tasks and returns a concise execution summary without
   creating a separate receipt artifact.
2. The next schema artifact invokes `openspec-verify-change`, runs fresh technical
   checks and writes `verify.md` for the current candidate.
3. Code failure invokes systematic debugging and returns to Apply.
4. Artifact drift returns to the owning artifact, then Apply.
5. Implementation changes require current evidence and a new human decision.

Feature Acceptance remains `PENDING` until a person explicitly selects `PASS` or
`FAIL` from the collected evidence. Agent reasoning and technical checks prepare evidence
but cannot make the human decision. Superspec Process Compliance is evaluated
separately and cannot weaken Feature Acceptance.

The standalone `/opsx:verify` (Claude) or `/opsx-verify` (Qwen/GigaCode) surface returns
the upstream verification report but does not persist a schema artifact.
Use the schema artifact flow when the governed
`verify.md` gate must be recorded after implementation.

## Closeout and Archive

A person explicitly invokes any required branch, review or PR command after Feature
Acceptance. `superpowers:finishing-a-development-branch` remains available, but the
schema does not call it or persist a separate closeout receipt.

Archive requires human Feature Acceptance and Superspec Process Compliance.
Resolve branch roles, PR directions, external status transitions and Release gates
from the project's `openspec/context/08-release-process.md`.

Archive does not perform UAT, deployment or Release. Successful UAT and a separate
human Release gate are required before Git Flow release. A UAT defect against an
archived Scenario creates a linked corrective Change and blocks Release; Master Specs
are not edited directly.
