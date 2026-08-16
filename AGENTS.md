# OpenSpec project rules

## Orchestrator Core freeze

Until the pilot is completed and reviewed, do not add product capabilities to
`src/`. Record every proposed Orchestrator enhancement in `BACKLOG.md` instead.

A Core change before the pilot is allowed only for a confirmed defect against the
current contract or a case that blocks the pilot. Record the observed case in
`docs/user/pilot-feedback.md`, choose the smallest fix, add a regression test, and avoid
expanding the eight current operations.

## Change ownership

All OpenSpec changes belong to the central sdd-specs repository.

Changes must be created only inside the OpenSpec store.

Backend and frontend repositories only implement existing changes. They must not contain their own `openspec/changes` directories.

## Source of truth

The only source of truth for requirements is:

```text
sdd-specs/openspec
```

## Early synchronization for dependent changes

Master Specs are normally updated during Archive. The only supported early-sync case is an accepted active Change A whose behavior is required to plan a dependent Change B in the same release.

For this case:

- merge the Planning PR for Change A first;
- run the standard `/opsx-sync <change-a>` from an up-to-date Store default branch in a separate `sync/<change-a>` branch;
- review the Master Specs diff and merge it through a separate Sync PR;
- create Change B only after the Sync PR is merged;
- reference Change A and its Sync PR in the Proposal and Design of Change B.

Change A remains active after Sync. Sync makes its accepted target behavior available as the normative basis for later Changes; it does not prove that the behavior is implemented or deployed and does not relax the Archive gates. Do not edit Master Specs directly and do not create a project-specific wrapper around `/opsx-sync`.

## Existing capabilities

When a Change alters behavior already present in Master Specs, keep each existing capability path and express the change through the standard Delta operation. One coherent Change may contain multiple Delta Specs, including nested capability paths; create one Delta Spec per affected capability. Do not create a replacement capability or versioned duplicate. The agent proposes `ADDED`, `MODIFIED`, `REMOVED`, or `RENAMED` by comparing the confirmed intent with the current Master Spec; ambiguity must be resolved by the Change Owner, and the Spec Owner confirms the result in the Planning PR.

## Archive rule

Archive is allowed only after:

- backend implementation is completed;
- frontend implementation is completed;
- manual verification is completed.

Archive dependent Changes in dependency order: Change A first, then Change B.

Do not modify built-in OpenSpec `openspec-*` skills or `opsx-*` commands in the provider-specific agent directory selected in `openspec-orch.yaml`. Keep project-specific process rules in `AGENTS.md` and project documentation.

## Reference flow documents

`docs/user/team-flow.md` is the current team process for this repository. Record
changes to Planning, repository impact, Gates, verification, Release and Archive in
that document and the related current project documentation.

`docs/archive/reference/OpenSpec для команды.md` is an immutable historical workplace
reference. It is retained for provenance only and is not a current instruction,
requirements source or runbook. Do not synchronize or normalize it to match the
current process.
