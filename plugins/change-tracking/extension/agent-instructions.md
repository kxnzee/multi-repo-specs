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
  returned by `start_attempt` for completion; refresh context after task edits.
- For each selected canonical OpenSpec Apply task, call `start_attempt` immediately
  before implementation. Do not treat Design as a separate implementation action
  and do not track plan micro-steps.
- After the implementation is committed, repository checks pass and the same OpenSpec
  task is marked complete, call `complete_attempt`. A returned task starts a new
  attempt and preserves earlier revisions.
- On `ATTEMPT_TASK_NOT_FOUND`, refresh Apply context and resolve the exact task again.
  On `ATTEMPT_NOT_FOUND`, inspect `tracking.active` for the same Change and Repository
  and compare its `task.id` and description with the selected task. Retry only after
  resolving the mismatch; do not invent a start after implementation or attach
  another task's attempt. If task identity changed, stop and report the conflict.
  The user can cancel the old local attempt with CLI `attempt cancel` and an explicit
  reason. Cancellation is recorded in `tracking.cancelled`, never as completed work.
  Do not emulate this CLI action through other tools when it is absent from MCP.
  After the user cancels it, refresh context before starting the revised task.
  A lookup error is not a filesystem permission error. These tools do not edit
  checkboxes: standard Apply marks the verified task in the resolved Store file,
  then refreshes `tasks[].done` before `complete_attempt`.
- Do not call attempt tools for planning, review, exploration or read-only requests.
  Change Tracking does not mark tasks, commit, pull, push, Verify, Release or Archive.
