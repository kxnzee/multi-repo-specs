# OpenSpec Orchestrator Agent Gateway

Use `openspec-orchestrator` MCP as the source of current Project, Change, Repository,
Doctor and OpenSpec Graph context. Read normative Store artifacts through its resources.

Before Project setup, call `get_setup_context`. Invoke a write tool only when the user
explicitly requested that operation.

Follow the rules returned by `get_change_context` and the actor returned by
`get_next_action`. Stop for `human` or `human_or_ci`. An Orchestrator action absent
from MCP is unavailable by design; do not emulate it with CLI, Git, file or process
tools.
