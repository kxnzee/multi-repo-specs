# Reference

## Runtime

- Node.js: `>=22.16.0`.
- OpenSpec executable должен быть в `PATH`.
- Core принимает semantic version OpenSpec; Change Tracking требует
  `>=1.11.0 <2`.
- Поддерживаемые Agents: `claude`, `qwen`, `gigacode`.

## Core CLI

```text
openspec-orch --version
openspec-orch init [path]
  --store <id> --agent <id>
  [--template <id-or-path>]
  [--extension <id>]... [--no-extensions]
  [--repo <id=remote#branch>]...
  [--no-strict]

openspec-orch doctor [--repo <id>]... [--json]
openspec-orch connect [--workspace <path>] [--no-strict]
openspec-orch disconnect

openspec-orch agent setup|status|remove --agent <id>
```

В TTY `init` без полного набора обязательных flags запускает выбор. В non-TTY
нужны `--store` и `--agent`. `doctor` только читает состояние; только итог
`blocked` возвращает exit code 1.

`doctor` по умолчанию печатает человекочитаемый отчёт, а с `--json` — тот же
Diagnostic Report в JSON. Без `--repo` он проверяет все Store и Code Repositories;
повторяемый `--repo <id>` ограничивает только Repository checks. Отчёт включает путь,
текущую ветку, `origin`, его совпадение с project config и чистоту рабочего дерева.
Ветка не сравнивается с `default_branch`, её имя и pattern не валидируются. Даже
detached HEAD остаётся read-only состоянием `connected`. Другой `origin` даёт
`identity_mismatch` и блокирует Doctor.

Root `disconnect` отключает локальные Agent Extensions и не меняет portable config.

## Plugin lifecycle

```text
openspec-orch plugin register <id> [path]
  [--name <name>]
  [--profile <commands|repository|native>]
  [--support <store|code>]...
  [--extension]

openspec-orch plugin init [--plugin <id>] [--from <source>] [--all]
openspec-orch plugin update <id> --from <source>
openspec-orch plugin connect <id> [--repo <id>]... [--all]
openspec-orch plugin status [--plugin <id>] [--repo <id>] [--json]
openspec-orch plugin sync <id> [--repo <id>]... [--all]
openspec-orch plugin exec [--repo <id>]... [--all] <id> <command> [args...]
openspec-orch plugin disconnect <id> [--repo <id>]... [--all]
openspec-orch plugin remove <id>
openspec-orch extension init <id> [--from <source>]
openspec-orch extension update <id> --from <source>
openspec-orch extension connect <id>
openspec-orch extension status [<id>] [--json]
openspec-orch extension disconnect <id>
openspec-orch extension remove <id>
openspec-orch package sync
openspec-orch package status [--json]
```

Фактические Plugin commands появляются после `plugin init`. Standalone Extension
lifecycle выполняется только через группу `extension`; общий `connect` при необходимости
сначала восстанавливает зафиксированный npm runtime, затем все объявленные Extensions.
Относительный path в `extension init/update --from` разрешается от каталога запуска
CLI. `update` — единственная операция явной смены package source; `package status`
только читает lock, provenance и локальный runtime, сверяя установленную версию и
отметку полного lockfile последней успешной установки. Progress идёт в stderr,
machine-readable output — в stdout.

## First-party commands

OpenSpec Graph:

```text
openspec-orch plugin exec openspec-graph inspect [--json]
openspec-orch plugin exec openspec-graph view [--port <port>]
```

Change Tracking:

```text
openspec-orch plugin exec --repo <store-id> change-tracking attempt start <change-id> <task-id>
openspec-orch plugin exec --repo <store-id> change-tracking attempt complete <change-id> <task-id>
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
  - spec-driven-extended
  - superpowers
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
- `get_change_context` — принимает опциональный `include_assignment: true`, чтобы
  вернуть `assignment_scope` в том же ответе без повторного Project envelope и второй
  компиляции Graph impact;
- `get_next_action`;
- `get_assignment_scope`;
- `get_doctor_report`;
- `query_graph` — Plugin-owned tool, доступный в дистрибутиве и исполняемый только
  через contribution `openspec-graph`.

Каждый успешный read-ответ содержит `context_revision`, scoped к имени tool, его
эффективным аргументам и фактически прочитанному результату. Для проверки свежести
клиент передаёт это значение как `if_context_revision`. MCP всё равно перечитывает
текущее состояние; если результат не изменился, он возвращает только
`{ "unchanged": true, "context_revision": "..." }`. Поэтому revision не является
TTL-кэшем и не разрешает переиспользовать payload другого tool или другого набора
аргументов. JSON tool results передаются без форматирующих пробелов.

Controlled setup tools:

- `initialize_project` — только cwd MCP и strict mode; принимает обязательные
  `store_id`, `agent_id`, опциональный bundled `template_id` и массив
  `repositories` только для Code Repositories с полями `repository_id`, `remote`,
  `default_branch`; центральный Store задаётся только через `store_id` и в этот массив
  не включается;
- `connect_project` — без workspace и relaxed overrides.

Перед `initialize_project` клиент должен вызвать `get_setup_context` и подтвердить
возвращённый `cwd`: tool не принимает другой target. Пользовательский сценарий
описан в [руководстве по началу работы](../user/getting-started.md#альтернатива-инициализация-через-mcp).

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
Такая же семантика действует для вложенного `assignment_scope`, если
`get_change_context` вызван с `include_assignment: true`.

MCP не предоставляет verification, Release, Archive, произвольные Git writes,
Plugin lifecycle, Agent management или network transport.

## Exit behavior

- `0` — успешное выполнение;
- `1` — runtime или validation failure;
- `2` — неверный CLI invocation.

Точный набор flags конкретной установленной версии всегда показывает
`openspec-orch <command> --help`.
