# Repository instructions

## Architecture boundaries

- Keep Orchestrator Core generic. Product process, provider behavior and
  Plugin-specific commands must not become special cases in `packages/core/`.
- Put reusable Plugin contracts in `packages/plugin-sdk/` and concrete runtime,
  repository lifecycle or Agent integration in the owning Plugin package.
- Project workflow, schema and Agent artifacts belong to Project Template or Plugin
  Template, not to Core runtime.
- Cover changes to observable behavior with regression tests and update current
  documentation when the public contract changes.

## OpenSpec ownership

- Requirements, Master Specs and Changes belong only to the central OpenSpec Store at
  `sdd-specs/openspec`.
- Do not create `openspec/changes` in this implementation repository or other Code
  Repositories. Implement an accepted Change from the Store.
- Follow [`docs/user/team-flow.md`](docs/user/team-flow.md) for Planning, Repository
  Impact, Gates, dependent Changes, verification, Release and Archive.
- Do not modify built-in OpenSpec `openspec-*` skills or `opsx-*` commands in the
  provider-specific directory selected in `openspec-orch.yaml`.

## Documentation

- Treat code and tests as the source of truth for runtime behavior. Verify claims
  before adding them to current documentation.
- Current documentation lives in `docs/user/` and `docs/technical/`.

## Validation

Run `npm run check` and `git diff --check` before committing repository changes.
