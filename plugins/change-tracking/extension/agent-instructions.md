## Change Tracking

When the user explicitly asks to implement an OpenSpec Change from the current Code
Repository, use the standard OpenSpec Apply workflow as the only implementation
entrypoint. Invoke the installed standard Apply through the Agent's native
skill/command mechanism before starting implementation. Reading MCP Apply Context,
calling an Apply preflight helper or starting tracking does not invoke standard
Apply. Do not create separate `implement-design` or `implement-plan` workflows.

- Reuse the current Work Context when it already matches the same Change, Apply artifact
  and freshness boundary. Otherwise call `get_change_context` once with
  `artifact: "apply"` and `include_assignment: true`; use its embedded
  `assignment_scope` instead of making a duplicate `get_assignment_scope` call. Follow
  the active schema's returned Apply instructions and resolved artifact paths; execute
  only the selected repository scope.
- Resolve the selected task in `artifact_instructions.tasks` by its full description
  and repository scope, then copy its exact `id` string into `task_id`. Markdown
  labels such as `1.1` or `2.3` are part of `description`, not necessarily the ID.
  For example, `{ "id": "4", "description": "2.3 Handle errors", "done": false }`
  requires `task_id: "4"`. Never calculate an index, strip a label, or choose the
  first matching task when ambiguous. Preserve the canonical ID and description
  returned by OpenSpec for recording; refresh context after task edits.
- Before resuming work, inspect `tracking.implementations` for this task and Repository.
  Read its PR and linked implementation plan. Check the recorded commits and remaining
  work before continuing. A partial PR does not mean the OpenSpec task is complete.
- Keep detailed implementation tasks and their checkboxes in the Code PR description
  or pinned plan comment. Before a PR exists, use the executor's local working plan.
  Do not duplicate this technical checklist in Store Tasks or implementation-map.
- At a partial handoff, PR update, or completed task, call `record_implementation`.
  Pass the exact `task_id` and `task_description`, published `pull_request`, optional
  `plan_url` (defaults to the PR), the full current list of implementation `commits`,
  `summary` of work and checks, and `remaining` work/blockers (empty when none).
  Use `expected_version` from the same task/Repository/PR entry, or 0 for a new entry.
  On IMPLEMENTATION_CONFLICT, re-read and reconcile with the other contributor;
  never blindly retry with a newer version. An unchanged retry is safe.
  PR fragments do not identify separate PRs; keep plan/comment anchors in `plan_url`.
- When a task ID/description changes, inspect the old record and current task with
  the user before reattaching evidence. After agreement call the same operation with
  `previous_task_id` from the old entry and its `expected_version`, while supplying
  the current task ID/description and the full intended snapshot. For a description
  change alone use the same ID. Never silently rebind a semantically different task.
- `tracking.tasks` includes tasks without PRs. Inspect its warnings alongside
  `tracking.implementations`: a done checkbox with remaining work, no implementation
  or no commits needs explanation/correction, not an automatic checkbox change.
  A no-code task can explain missing commits in summary. `legacy_error` reports
  local attempt storage corruption; current links remain usable. Do not delete old state.
- Record only explicit full SHA values from the implementation checkout, including
  worktrees. Never substitute the main checkout HEAD or infer commits from a checkbox.
  For squash/rebase, refresh the list to published commits and explain the replacement
  in the PR. A commit missing locally must be obtained through the team's normal Git
  process before retrying; Tracking does not fetch or publish.
- Standard Apply marks the parent OpenSpec checkbox only after all required work and
  checks pass. Keep it open for partial work. Tracking reads current checkboxes; it
  never edits them. After a checkbox change refresh context and update the PR handoff.
- Publish the map together with task updates through the normal Store PR process.
  For a partial handoff publish the link before completion/code merge, otherwise
  another checkout cannot discover it. No separate history commit, local attempt,
  clean-Store gate or background PR synchronization is required by this flow.
- `start_attempt` and `complete_attempt` serve local attempts;
  do not create them for new work. Existing active attempts can be cancelled with
  CLI `attempt cancel` and an explicit reason; do not silently delete local history.
- Do not record implementation for planning, review, exploration or read-only requests.
  Change Tracking does not commit, pull, push, create/edit PRs, Verify, Release or Archive.
