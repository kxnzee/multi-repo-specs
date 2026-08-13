# OpenSpec project rules

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

Do not modify built-in OpenSpec `openspec-*` skills or `opsx-*` commands in the provider-specific agent directory selected in `sdd.yaml`. Keep project-specific process rules in `AGENTS.md` and project documentation.

## Reference flow document

`docs/OpenSpec для команды.md` is a read-only reference from the workplace. It exists to keep the project's overall lifecycle recognizably aligned with the common flow, while this repository may implement that flow with custom commands, steps, and gates.

Do not synchronize, normalize, or edit this file to match the local SDD implementation unless the user explicitly requests changes to this exact file. Record project-specific behavior in `docs/steps/`, `AGENTS.md`, or other local documentation instead.
