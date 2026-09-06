# Pilot readiness audit — 2026-09-06

## Baseline and scope

- Base: `master`, `0afb053fad21d56677960ec9978a986861e04d67`, after fetching origin.
- Branch: `fix/pilot-readiness-audit`; no other branch changes imported.
- Local environment: Linux, Node 24.19.0, npm 11.9.0, locked OpenSpec 1.11.0.
- Baseline: clean `npm ci`; `npm run check:all` passed 327 tests and installed all
  8 publishable packages in an isolated consumer. No baseline test failures.
- Sources: AGENTS, README, current user/technical docs, manifests, owned code and
  tests. No external central Store / accepted Change was supplied. This audit fixes
  technical behavior within the existing contracts; it does not invent project workflow.
- Third-party dependencies and bundled third-party skills were not edited.

The product remains a local environment/integration layer. OpenSpec owns central
requirements and Changes; Core owns Project/Repository/config/package operations;
SDKs own public contribution contracts; Plugins own tracking and graph semantics;
adapters own native provider calls; Templates own copy-only project process;
Extensions own Agent payloads. No additional local requirements Store was created.

## Findings

| ID | Confirmed issue | Resolution / verification |
|---|---|---|
| F01 | CLI connect from Code Repository handed its cwd to Store-only Core and Plugin setup. | Resolved Store root is propagated to connection and Plugin lifecycle. Unit regression and real public first-run/reconnect smoke. |
| F02 | First failed compensation stopped all remaining compensations. | Continue in reverse order and aggregate every failure with the original error. Regression verifies all callbacks and retained errors. |
| F03 | Repeated init updated Extension declarations before checking incomplete Store state. | Validate completeness before mutation. Regression verifies unchanged config bytes after failure. |
| F04 | Relative `file:` package sources were interpreted under npm runtime cwd. | Resolve against caller cwd before npm invocation, for Plugins and Extensions via shared source. |
| F05 | Implementation-map deduplication depended on YAML key order. | Compare semantic identity fields, including task ID/description, independent of serialization order. |
| F06 | Explicit same-version local package update retained old npm content. | Remove the previous resolution inside the package transaction before installing the explicit source. Real npm regression checks changed installed bytes. |
| F07 | Package reads/sync did not check the complete runtime directory chain before npm. | Shared ancestor validation precedes reads and mutations. Symlink regressions verify no external writes. |
| F08 | ESM cache could return old Plugin/helper code after update. | Loader checks package content and supplied lock revision, fails with restart guidance on changed module graph; CLI loads Plugins on demand before execution, not before package updates. |
| F09 | External MCP tools bypassed numeric and nested JSON Schema constraints. | Use the existing MCP SDK JSON Schema validator for Plugin tools before application dispatch. Invalid requests never invoke the handler. |
| F10 | Malformed schema artifact `null` produced an unclassified TypeError. | Stable MCP_RESOURCE_SCHEMA_INVALID diagnostic. |
| F11 | Graph file traversal could follow a symlinked openspec ancestor. | One Graph-owned ancestor checker used by file and directory readers. Regression verifies rejection. |
| F12 | Abandoned lock message only suggested retry, which cannot release a crashed process lock. | Include exact lock path and manual recovery conditions; retain fail-closed policy. |
| F13 | Packed smoke only checked imports and CLI version; distribution smoke had an unused skip switch. | Remove skip switch; reuse real CLI/MCP scenario tests against installed tarball entrypoints, including fresh init/reconnect/Doctor. |
| F14 | Delayed duplicate completion could delete a newer reopened attempt; malformed active entries escaped validation. | Compare active attempt identity before cleanup and validate each persisted entry. Race regression and corruption diagnostic test. |

## Verification boundaries

| Area | Evidence and limits |
|---|---|
| Core, configuration, paths, files, locks, lifecycle, rollback | Full owned test suite plus defect regressions; real filesystem and Git fixtures, with injected failures where required. Simultaneous external file replacement during a filesystem syscall is not a sandbox guarantee. |
| Package install/update/remove/sync | Real npm local install/update and Git SHA restore, lock/version/transitive-drift tests, broken-state and interrupted-sync injection. Local file sources are mutable and cannot provide a historical source backup. |
| Public CLI and MCP | Real child processes, stdio SDK handshake, resources, tools, Graph query, tracking completion and repeat connection. Native provider calls use a fake Qwen executable. |
| Change Tracking | Start/complete/reopen, task/schema identity, dirty/missing checkout, durable completion and concurrent different-task writes. No feature acceptance or release semantics added. |
| OpenSpec Graph | Real compiler, file parsing, diagnostics, provenance, live loopback HTTP viewer and public MCP route. No persisted graph or ownership inference added. |
| SDKs, Agent adapters, Extensions, Templates | Contract/structural tests, provider command and scope assertions; own assets inspected. Third-party skills unchanged. Actual Claude/Qwen/GigaCode accounts were not exercised. |
| CodeGraph | Wrapper/status/index ownership tests and injected native responses. Actual CodeGraph runtime/indexing not validated here. |
| npm distribution | Eight tarballs, empty-cache consumer, exported imports plus installed CLI/MCP scenarios. No npm release performed. |
| Windows/macOS | Must be confirmed by GitHub Actions for the final PR commit; local Linux tests do not substitute for these jobs. |

## Operational limits and remaining gates

- Do not hot-update a running Agent/MCP session. Restart it after package or
  distribution changes; tool discovery occurs when MCP starts.
- A crash can leave an exclusive directory lock. Stop Store processes, preserve
  state and remove only the identified empty lock directory. See the recovery runbook.
- First init is not a migration/repair engine. Preserve partial output and recover
  from a clean approved Store checkout; arbitrary native Plugin side effects are
  not transactionally reversible by Core.
- Pilot approval still requires native smoke for the chosen Agent/provider and
  CodeGraph if enabled, including payload replacement, scope and reconnect. This
  environment has not established those runtime contracts against real providers.
- Final CI and local verification results are recorded in the PR. Passing tests
  does not establish absence of other bugs or validate production accounts/hosting.

## Contract and upgrade notes

Project config remains version 1; CLI grammar, tracking map version and SDK API
versions are unchanged. Invalid MCP inputs are now rejected according to their
advertised schema. Reinstalling an external package intentionally re-resolves that
package, so review its manifest/lock diff. Restart long-lived processes after update.
No automatic Store migration, release, deployment or merge is part of this audit.
