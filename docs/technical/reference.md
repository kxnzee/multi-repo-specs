# Reference

## Runtime

- Node.js: `>=20.19.0`.
- OpenSpec executable должен быть в `PATH`.
- Core принимает semantic version OpenSpec; Change Tracking требует
  `>=1.11.0 <2`.
- Поддерживаемые Agents: `claude`, `qwen`, `gigacode`.

## Core CLI

```text
openspec-orch init [path]
  --store <id> --agent <id>
  [--template <id-or-path>]
  [--extension <id>]... [--no-extensions]
  [--repo <id=remote#branch>]...
  [--no-strict]

openspec-orch doctor [--json]
openspec-orch connect [--workspace <path>] [--no-strict]
openspec-orch disconnect

openspec-orch agent setup|status|remove --agent <id>
openspec-orch repository status [--repo <id>]...
```

В TTY `init` без полного набора обязательных flags запускает выбор. В non-TTY
нужны `--store` и `--agent`. `doctor` только читает состояние; только итог
`blocked` возвращает exit code 1.

Root `disconnect` отключает локальные Agent Extensions и не меняет portable config.

## Plugin lifecycle

```text
openspec-orch plugin register <id> [path]
  [--name <name>]
  [--profile <commands|repository|native>]
  [--support <store|code>]...
  [--extension]

openspec-orch plugin init [--plugin <id>] [--from <source>] [--all]
openspec-orch plugin connect <id> [--repo <id>]... [--all]
openspec-orch plugin status [--plugin <id>] [--repo <id>] [--json]
openspec-orch plugin sync <id> [--repo <id>]... [--all]
openspec-orch plugin exec <id> [--repo <id>]... [--all] -- <command> [args...]
openspec-orch plugin disconnect <id> [--repo <id>]... [--all]
openspec-orch plugin remove <id>
```

Фактические Plugin commands появляются после `plugin init`. Progress идёт в
stderr, machine-readable output — в stdout.

## First-party commands

OpenSpec Graph:

```text
openspec-orch graph inspect [--json]
openspec-orch graph view [--port <port>]
```

Change Tracking:

```text
openspec-orch track <change-id> [--no-push]
openspec-orch done [--change <change-id>] [--sha <sha1>]
  [--source <human|agent|ci>] [--no-push]
openspec-orch status [change-id] [--json]
openspec-orch verify <pass|fail> [--change <change-id>]
  [--source <human|ci>] [--note <text>] [--no-push]
```

CodeGraph использует общий `plugin connect/status/sync/exec/disconnect`.

## Project config

`openspec-orch.yaml` поддерживает только version 2:

```yaml
version: 2
strict: true
template: {id: default}
agent: {id: qwen}
extensions:
  - id: openspec-base
    source: bundled:openspec-base
  - id: superpowers
    source: bundled:superpowers
plugins: []
repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: []
```

Должен существовать ровно один Store Repository. Plugin binding ссылается на
верхнеуровневую declaration. Поля и local state описаны в
[пользовательском справочнике](../user/configuration.md).

## MCP

Executable `openspec-orch-mcp` обслуживает только stdio.

Read tools:

- `get_status`;
- `get_setup_context`;
- `get_change_context`;
- `get_next_action`;
- `get_assignment_scope`;
- `get_doctor_report`;
- `query_graph`.

Controlled setup tools:

- `initialize_project` — только cwd MCP и strict mode;
- `connect_project` — без workspace и relaxed overrides.

Resources ограничены Project config, OpenSpec config, Markdown/YAML context, Master
Specs, schema-declared Change artifacts и YAML tracking journals. `.openspec.yaml`
и произвольные Store files не публикуются.

MCP не предоставляет receipt/verification, Release, Archive, arbitrary Git writes,
Plugin lifecycle, Agent management или network transport.

## Exit behavior

- `0` — успешное выполнение;
- `1` — runtime или validation failure;
- `2` — неверный CLI invocation.

Точный набор flags конкретной установленной версии всегда показывает
`openspec-orch <command> --help`.
