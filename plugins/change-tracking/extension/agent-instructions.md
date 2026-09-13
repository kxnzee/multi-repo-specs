## Change Tracking

Use Tracking writes only when implementing an explicitly selected OpenSpec Change from a
Code Repository. Invoke the installed standard OpenSpec Apply workflow first.
Reuse fresh Work Context, or request `get_change_context` with `artifact: "apply"`
and `include_assignment: true`. Follow the active schema and selected repository
scope. Tracking does not invoke Apply, edit task checkboxes or run tests.

For a project overview, call `tracking_status` with `all: true` instead of a Change
ID. It lists active OpenSpec Changes, checkpoints and issues; it does not choose
work or prove release readiness. Expand only the relevant Change/task.

1. Read `tracking_status` before starting or resuming. Select the exact task ID
   from `artifact_instructions.tasks`; a display label such as `2.3` is not its ID.
   Pass `task_id` to get the task's next step, handoff note and resolved Apply paths.
   Add `diff: true` only when comparison is useful: it shows repository-wide changes
   since the latest checkpoint/complete, with uncommitted files separate. Do not
   attribute every changed file to this task. No saved point means no comparison.
2. Call `tracking_start` with `change_id` and `task_id`. It captures Git revisions
   and the full planning inputs automatically. For a published checkpoint, prepare
   its exact Code revision through the team's ordinary Git workflow first; request
   `tracking_status` with `details: true` when you need that revision.
3. Implement and run the repository checks. A commit can cover multiple tasks;
   never create an empty commit solely for Tracking.
4. For partial handoff, call `tracking_checkpoint`, optionally with a short `note`
   explaining the next step. Keep the OpenSpec task open. Publish the Code commit
   and Store map through the team's Git process so another checkout can resume.
5. Once Apply has marked the task done, call `tracking_complete`. It records the
   current clean checkout; it does not prove that tests ran or that Verify passed.

All writes require the invoking Code checkout. The Plugin is bound to the Store;
Code bindings deliver these instructions. No hosting API or additional MCP is needed.
Never supply PR links, commit lists, copied task descriptions or storage versions.

On a changed plan, diverged checkout or concurrent update, inspect the difference
before proceeding. `tracking_cancel` drops only this checkout's local cursor and
requires a reason; published checkpoints remain. `tracking_start(restart: true)`
explicitly acknowledges a fresh start from the current committed plan and checkout;
use it only after the user has confirmed the new scope/history. Never silently
attach evidence to a reordered or semantically different task.

`tracking_status` separates record state, the live OpenSpec checkbox and checkout
correspondence. Use the returned message and next step in a short user update, not
a technical log. Unknown data stays unknown; a local start does not prove a live
agent, and an executor's note does not prove a passed test. `ahead` is not an exact
match or an error by itself; `dirty`, `missing_commit`, `diverged` and `unavailable`
need resolution before verification.
Tracking does not checkout, fetch, commit, publish, accept, release or archive.
