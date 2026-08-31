# Superspec Multi-Repository

This schema combines OpenSpec governance with the complete Superpowers engineering
discipline for an OpenSpec Orchestrator Store.

OpenSpec is the artifact orchestrator. Superpowers supplies the skills that conduct
brainstorming, detailed planning, isolated implementation, TDD, debugging, reviews,
fresh verification and branch closeout. Orchestrator supplies exact repository scope
and the external team gates. None of the three is a
replacement for the others.

## Lifecycle

```text
brainstorm
→ proposal
→ optional design
→ specs
→ tasks
→ plan
→ apply
→ verify
→ finalize
→ Release gate
→ archive
```

Apply and Verify form a convergence loop. Every Apply iteration overwrites `apply.md`
with a higher iteration number; Verify checks that exact iteration and current
candidate. A failure returns to the owning artifact or Apply. Finalize becomes
reachable only when Candidate Acceptance is `PASS` and Superspec Process Compliance
is `PASS` or `PASS_WITH_WARNINGS`.

## No parallel documents

Superpowers' brainstorming and writing-plans outputs are redirected to the active
OpenSpec Change. Do not create a second design or plan under `docs/superpowers/`.
`apply.md`, `verify.md` and `finalize.md` are OpenSpec receipts for the skill-driven
workflow, not additional task lists.

## Multi-repository adaptation

- The Store owns Change artifacts and cross-repository workflow receipts.
- Proposal owns exact Repository Impact using IDs from `openspec-orch.yaml`.
- Code changes, worktrees, TDD and repository verification remain in Code Repositories.
- Technical Verify cannot complete the external current-version checkpoint.
- Finalize uses Superpowers' structured branch choices separately for each repository
  and requires explicit authorization for external mutations.
- Release remains a team gate and is required before Archive.

See `INTEGRATION.md` for operational handoffs and failure routes. Upstream attribution
and the adaptation baseline are recorded in `NOTICE.md`.
