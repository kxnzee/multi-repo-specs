# Working on OpenSpec Orchestrator

This is the implementation repository for a local CLI, not an OpenSpec Store.
It uses JavaScript ES modules and npm workspaces. Normal development needs no
compilation step, application server, database or provider account.

## Start here

1. Read the task and inspect `git status --short --branch`. Confirm the requested
   base/PR commit, preserve existing work and use a separate branch for a new task.
   Refresh remote refs before reviewing or publishing against them.
2. Read `README.md` and `docs/technical/development.md`. Use `docs/README.md`
   to locate further documentation relevant to the task.
3. Use Node >=22.16.0 and Git. `.nvmrc` selects the minimum version tested in CI.
   Run `npm ci` in the root, then `npm run check:environment`. OpenSpec 1.11.0
   is a locked dev dependency; global installs and `npm link` are unnecessary.
4. Run the local CLI with `node bin/openspec-orch.js --help`. Test commands supply
   the local OpenSpec PATH and disable telemetry/update checks without changing
   the user's global configuration.

## Find the owning layer

| Area | Implementation | Tests |
|---|---|---|
| Distribution and CLI/MCP composition | `bin/` | `test/` |
| Generic domain, files, Git, lifecycle, package supply | `packages/core/` | `packages/core/test/` |
| Public Plugin contract | `packages/plugin-sdk/` | `packages/plugin-sdk/test/` |
| Public Extension contract | `packages/extension-sdk/` | `packages/extension-sdk/test/` |
| MCP protocol and schemas | `packages/mcp/` | `packages/mcp/test/` |
| Concrete Plugin behavior | `plugins/<id>/` | owning Plugin's `test/` |
| Provider adapters | `agents/` | `packages/core/test/`, `test/` |
| Copy-only project context and schemas | `templates/` | `test/structural/` |
| Agent workflow payloads | `extensions/` | `test/structural/` |

- Keep Core generic. Product process, provider behavior, concrete Plugin IDs and
  Plugin commands must not become special cases in `packages/core/`.
- Put reusable contracts in the owning SDK. Plugins use the public Plugin SDK,
  not Core internals; they own CLI/MCP handlers and response overlays.
- Template owns project context and schemas. Standalone or Plugin-owned
  Extensions own workflow assets; provider execution belongs in adapters.
- Separate machine-readable stdout from progress on stderr. Preserve scoped
  paths, validation before mutation and fail-closed handling of unknown state.

## Efficient iteration

- Start with `rg` and the owning layer; avoid reading all bundled skills or
  generated payloads for unrelated tasks. Read relevant tests before changing a
  public contract.
- Run a specific file through the root entrypoint:
  `npm run test:code -- packages/core/test/package-supply.test.js`.
  For a named case, put the option before the path:
  `npm run test:code -- --test-name-pattern="immutable Git revision" packages/core/test/package-supply.test.js`.
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
  Also run `npm run test:pack` when changing dependencies, workspaces, entrypoints,
  exported APIs, package files or packaging/CI scripts. `npm run check:all`
  runs both suites. Documentation-only work needs relevant command/link checks.
- `test:pack` installs tarballs in a separate consumer and needs npm registry
  access. Distinguish access failures from code failures; never report a blocked
  or skipped check as passed.
- After external package changes restart long-lived MCP processes; do not bypass
  Plugin Loader restart diagnostics with cache-busting entrypoint URLs.
- Update current docs under `docs/user/` or `docs/technical/` for behavior changes.
  Code, tests and manifests are the source of truth for runtime claims.
- Review the staged diff. Commit/push/open a PR when requested; a request to
  deliver a PR includes publishing its branch. Do not merge or force-push shared
  history unless explicitly requested.
- Report changes, executed checks, remaining limitations and the PR URL. Do not
  claim native provider behavior was tested when the suite used a fake.
