# Superspec multi-repository context

This Store uses OpenSpec for governed Change artifacts and the Superpowers Extension
for engineering execution discipline.

## Ownership

- OpenSpec owns `brainstorm.md`, Proposal, Delta Specs, optional Design, Tasks,
  `plan.md`, `apply.md`, `verify.md` and `finalize.md` inside the active Change.
- Superpowers owns the execution discipline: brainstorming, detailed planning,
  isolated worktrees, TDD, debugging, task/final review, evidence-before-completion
  and structured branch closeout. Its default document paths are overridden by the
  `superspec-multirepo` schema; do not create parallel planning documents under
  `docs/superpowers/`.
- `openspec-orch.yaml` owns the exact Store and Code Repository registry. Use only
  registered repository IDs when describing Repository Impact, Tasks and Plan work.
- Plugins own their runtime state and receipts. A Plugin receipt is evidence, not a
  replacement for Requirements or external verification.

## Multi-repository boundary

Governed artifacts and the cross-repository receipts live in the central Store.
Implementation and repository-local verification run in affected Code Repositories.
Do not assume that the Store is also an implementation repository or that one branch
outcome is valid for every Code Repository.

The Finalize phase preserves Superpowers' structured branch choices, but every
repository outcome and external mutation requires explicit user or accepted
team-process authorization. Finalize never implies deployment, Release or Archive.

Technical Verify is mandatory but does not close the final external verification
checkpoint. Obtain confirmation from the responsible participant for the current
deployed version; a new candidate or deployment invalidates the earlier confirmation.
