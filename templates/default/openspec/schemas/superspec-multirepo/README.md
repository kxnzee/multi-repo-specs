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
→ /opsx:apply (implementation action, no artifact)
→ verify
→ Release gate
→ archive
```

Apply and Verify form a convergence loop without a separate Apply receipt. Apply
updates implementation and completed Tasks; Verify independently checks the current
feature with current evidence and records an explicit human decision. A
failure returns to the owning artifact or Apply. Verify completes when Feature
Acceptance is `PASS` and Superspec Process Compliance is `PASS` or
`PASS_WITH_WARNINGS`.

## No parallel documents

Superpowers' brainstorming and writing-plans outputs are redirected to the active
OpenSpec Change. Do not create a second design or plan under `docs/superpowers/`.
`verify.md` is the human Feature Acceptance artifact, not an additional task list.
Apply produces no separate receipt artifact.

## Multi-repository adaptation

- The Store owns Change artifacts and the accepted cross-repository scope.
- Proposal owns exact Repository Impact using IDs from `openspec-orch.yaml`.
- Code changes, worktrees, TDD and repository verification remain in Code Repositories.
- Technical evidence cannot complete the Human gate.
- A person explicitly invokes any required branch, review or PR command or
  `superpowers:finishing-a-development-branch`; the schema stores no closeout receipt.
- Release remains a team gate and is required before Archive.

See `INTEGRATION.md` for operational handoffs and failure routes. Upstream attribution
and the adaptation baseline are recorded in `NOTICE.md`.
