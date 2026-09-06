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
