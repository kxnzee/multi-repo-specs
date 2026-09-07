# Third-party notice

The files under `skills/` are vendored from
[`obra/superpowers`](https://github.com/obra/superpowers), release `v6.1.1`
(source tree `d884ae04edebef577e82ff7c4e143debd0bbec99`).

Copyright (c) 2025 Jesse Vincent. Licensed under the MIT License reproduced in
`LICENSE`.

The OpenSpec Orchestrator manifests, bootstrap adapter and Claude hook in this
Extension are distribution adapters and are not part of the upstream snapshot.

Local adaptations to the vendored skills preserve the OpenSpec artifact handoff,
extract a single repository task, isolate progress by plan/checkout/branch, and
retain worktree identity and ownership during closeout. The portable
`skills/subagent-driven-development/scripts/task-context.cjs` helper is maintained
by OpenSpec Orchestrator. The unavailable platform-reference link was removed.

The subsequent full asset audit also aligns schema routing and reviewer handoffs,
clarifies worktree authority, repairs helper error handling and local module
compatibility, and corrects reference examples.
These adaptations are not claims about unchanged upstream behavior.

Project schema instructions now own governed artifact routing; project policy owns
Git remotes, protected branches and authorized model selection. The polluter helper
requires an explicit test runner and passes its arguments without shell evaluation.

The OpenSpec checklist substitutions are documented in-place, leaving the standalone
Superpowers flow intact. Blocker escalation follows the existing Model Selection
policy rather than introducing a second model policy.
