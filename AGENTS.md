# Working on OpenSpec Orchestrator

This is the implementation repository for a local CLI, not an OpenSpec Store.
It uses JavaScript ES modules and npm workspaces. Normal development needs no
compilation step, application server, database or provider account.

## Start here

1. Read the task and inspect `git status --short --branch`. Confirm the requested
   base/PR commit, preserve existing work and use a separate branch for a new task.
   Refresh remote refs before reviewing or publishing against them.
2. Read `README.md` and `docs/core/development.md`. Use `docs/core/README.md`
   to locate further Core documentation.
3. Use Node >=22.16.0 and Git. `package.json` and CI define the minimum supported
   Node version.
   Run `npm ci` in the root, then `npm run check:environment`. OpenSpec 1.11.0
   is a locked dev dependency; global installs and `npm link` are unnecessary.
4. Run the local CLI with `node src/bin/openspec-orch.js --help`. Test commands supply
   the local OpenSpec PATH and disable telemetry/update checks without changing
   the user's global configuration.

## Find the owning layer

| Area | Implementation | Tests |
|---|---|---|
| Distribution and CLI/MCP composition | `src/bin/` | `test/` |
| Generic domain, files, Git, lifecycle, package supply | `src/packages/core/` | `src/packages/core/test/` |
| Public Plugin contract | `src/packages/plugin-sdk/` | `src/packages/plugin-sdk/test/` |
| Public Extension contract | `src/packages/extension-sdk/` | `src/packages/extension-sdk/test/` |
| MCP protocol and schemas | `src/packages/mcp/` | `src/packages/mcp/test/` |
| Concrete Plugin behavior | `plugins/<id>/` | owning Plugin's `test/` |
| Provider adapters | `src/agents/` | `src/packages/core/test/`, `test/` |
| Copy-only project context and schemas | `templates/` | `test/structural/` |
| Agent workflow payloads | `extensions/` | `test/structural/` |

- Keep Core generic. Product process, provider behavior, concrete Plugin IDs and
  Plugin commands must not become special cases in `src/packages/core/`.
- Put reusable contracts in the owning SDK. Plugins use the public Plugin SDK,
  not Core internals; they own CLI/MCP handlers and response overlays.
- Template owns project context and schemas. Standalone or Plugin-owned
  Extensions own workflow assets; provider execution belongs in adapters.
- Separate machine-readable stdout from progress on stderr. Preserve scoped
  paths, validation before mutation and fail-closed handling of unknown state.

## Non-negotiable layer independence

- OpenSpec schema steps own their instructions, artifacts and progress. A step
  must work unchanged when every optional Plugin is absent; do not mention or
  require Plugin commands, MCP tools, state files or response fields in a step.
- A Plugin owns only its declared capability. It must not read, write, advance,
  complete or block OpenSpec steps, artifact instructions or task checkboxes.
  Shared identifiers may correlate records, but must not transfer lifecycle
  ownership between the Plugin and the OpenSpec workflow.
- Core and the base MCP surface remain generic. Do not add knowledge of a
  concrete Plugin, Template or schema to make two layers coordinate implicitly.
  Optional integration is allowed only through public contribution contracts and
  must preserve the standalone behavior of every participating layer.
- Before changing a Template step or Plugin workflow, inspect dependencies in
  both directions and add focused regression coverage for independence. A green
  end-to-end scenario does not justify a cross-layer dependency.

## Efficient iteration

- Start with `rg` and the owning layer; avoid reading all bundled skills or
  generated payloads for unrelated tasks. Read relevant tests before changing a
  public contract.
- Run a specific file through the root entrypoint:
  `npm run test:code -- src/packages/core/test/package-supply.test.js`.
  For a named case, put the option before the path:
  `npm run test:code -- --test-name-pattern="immutable Git revision" src/packages/core/test/package-supply.test.js`.
- Add regression coverage for observable behavior changes. For docs/configuration
  edits, check actual commands and links instead of merely testing the edited text.
- Build paths with `node:path`, isolate fixtures under the OS temp directory,
  close child processes/clients before removing their working directories, and
  restore changed environment variables. Windows CI is required.
- Do not hide failures with skipped suites, `--test-force-exit` or longer timeouts.
  Root tests are serial with a 180-second test timeout; investigate leaked handles
  and external commands when a run stalls.

## OpenSpec and instruction ownership

- Requirements, Master Specs and normative Changes belong to a separate central
  Store. Resolve its actual location from task context or project configuration;
  do not assume a sibling checkout named `sdd-specs` exists.
- When a task refers to an accepted Change, read its requirements and repository
  impact before implementing product behavior. Report a missing required source
  precisely; do not invent requirements or a local substitute.
- Explicitly requested repository maintenance (environment, CI, documentation and
  developer instructions) can be completed here. Do not create `openspec/changes`
  in this implementation repository to represent that work.
- `docs/user/story-delivery-process.md` describes delivery in projects using the
  product. Preserve a supplied project's Git roles and PR directions; Core must
  not impose branch-name conventions on those projects.
- This `AGENTS.md` governs development of Orchestrator. Files under `templates/`
  and `extensions/` are shipped assets, not instructions for this checkout.
  Do not install providers, run user-level `agent setup`, or edit built-in
  OpenSpec `openspec-*` skills / `opsx-*` commands as repository setup.

## Finish and report

- For code/environment changes, run `npm run check` and `git diff --check`.
  Also run `npm run test:pack` and `npm run test:pack:consumer` when changing
  dependencies, workspaces, entrypoints, exported APIs, package files or
  packaging/CI scripts. `npm run check:all` includes the local package check.
  Documentation-only work needs relevant command/link checks.
- `test:pack` checks local tarballs and public entrypoints without registry access.
  `test:pack:consumer` installs them in a separate consumer and needs npm registry
  access; run it for release validation or a controlled CI job. Distinguish its
  access failures from code failures; never report a blocked or skipped check as passed.
- After external package changes restart long-lived MCP processes; do not bypass
  Plugin Loader restart diagnostics with cache-busting entrypoint URLs.
- Update current docs under `docs/user/`, `docs/core/`, `docs/plugins/`,
  `docs/extensions/` or `docs/templates/` for behavior changes.
  Code, tests and manifests are the source of truth for runtime claims.
- Review the staged diff. Commit/push/open a PR when requested; a request to
  deliver a PR includes publishing its branch. Do not merge or force-push shared
  history unless explicitly requested.
- Report changes, executed checks, remaining limitations and the PR URL. Do not
  claim native provider behavior was tested when the suite used a fake.
