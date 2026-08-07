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

## Archive rule

Archive is allowed only after:

- backend implementation is completed;
- frontend implementation is completed;
- manual verification is completed.

Do not modify built-in OpenSpec skills or commands under `.qwen/skills/openspec-*` and `.qwen/commands/opsx-*`. Keep project-specific process rules in `AGENTS.md` and project documentation.
