# Upstream attribution

This Template adapts the schema-level integration pattern and artifact concepts from
[`danielhanold/superspec`](https://github.com/danielhanold/superspec), schema version 4,
commit `e1c8f417ee3601208416d988ba3b37d83ddb63f2`.

The adaptation preserves the complete upstream artifact and skill lifecycle through
Apply, Verify and Finalize while keeping the Superpowers skills unmodified. Concrete
single-repository assumptions are mapped to exact OpenSpec Orchestrator Repository
IDs, per-repository worktrees and outcomes, Change Tracking Result Receipts/Snapshot,
the current-version external verification checkpoint and the team's Release gate.

Unlike upstream's canonical automatic single-repository Git closeout, this adaptation
invokes `superpowers:finishing-a-development-branch` per Code Repository only after
explicit user or accepted team-process authorization. This changes authority and
topology, not the Superpowers planning, TDD, review, verification or closeout concepts.

Superspec is distributed under the MIT License. See `LICENSE.upstream`.
