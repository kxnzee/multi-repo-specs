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
openspec-orch attempt start <change-id> <task-id>
openspec-orch attempt complete <change-id> <task-id>
```

CLI fallback запускается из Code Repository и требует binding `change-tracking` как к
Store, так и к этому Code Repository. Governed MCP attempt tools используют Store
setup-context и не требуют передавать Store path в Agent-сессию.

CodeGraph использует общий `plugin connect/status/sync/exec/disconnect`.

## Project config

`openspec-orch.yaml` поддерживает только version 1:

```yaml
version: 1
strict: true
template: {id: default}
agent: {id: qwen}
extensions:
  - id: spec-driven-extended
    source: bundled:spec-driven-extended
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

- `get_status` — при переданном `change_id` включает активные и завершённые attempts;
- `get_setup_context`;
- `get_change_context`;
- `get_next_action`;
- `get_assignment_scope`;
- `get_doctor_report`;
- `query_graph`.

Controlled setup tools:

- `initialize_project` — только cwd MCP и strict mode;
- `connect_project` — без workspace и relaxed overrides.

Task evidence tools:

- `start_attempt` — локально фиксирует task и base revision текущего Code Repository;
- `complete_attempt` — требует выполненный task из OpenSpec Apply и записывает
  итоговую revision в Change-local implementation map; повторная реализация того же
  task добавляется как новая attempt.

Resources ограничены Project config, OpenSpec config, Markdown/YAML context, Master
Specs и schema-declared Change artifacts. `.openspec.yaml` и произвольные Store
files не публикуются.

В `get_assignment_scope` поле `assigned` равно `true` или `false`, когда scope
подтверждён подключённым OpenSpec Graph, и `null`, когда Graph недоступен. В последнем
случае Agent подтверждает repository-id по строгой таблице Repository Impact из
Proposal, доступного как MCP resource; `null` не означает отсутствие назначения.

MCP не предоставляет verification, Release, Archive, произвольные Git writes,
Plugin lifecycle, Agent management или network transport.

## Exit behavior

- `0` — успешное выполнение;
- `1` — runtime или validation failure;
- `2` — неверный CLI invocation.

Точный набор flags конкретной установленной версии всегда показывает
`openspec-orch <command> --help`.
