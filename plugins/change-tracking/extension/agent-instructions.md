## Change Tracking

When the user explicitly asks to implement an OpenSpec Change from the current Code
Repository, use the standard OpenSpec Apply workflow as the only implementation
entrypoint. Do not create separate `implement-design` or `implement-plan` workflows.

- Call `get_change_context` with `artifact: "apply"`, then resolve the current
  Repository through `get_assignment_scope`. Follow the active schema's returned
  Apply instructions: a Superspec Change executes its repository section of
  `plan.md`; another schema may use a different Apply artifact.
- For each selected canonical OpenSpec Apply task, call `start_attempt` immediately
  before implementation. Do not treat Design as a separate implementation action
  and do not track plan micro-steps.
- After the implementation is committed, repository checks pass and the same OpenSpec
  task is marked complete, call `complete_attempt`. A returned task starts a new
  attempt and preserves earlier revisions.
- Do not call attempt tools for planning, review, exploration or read-only requests.
  Change Tracking does not mark tasks, commit, pull, push, Verify, Release or Archive.
