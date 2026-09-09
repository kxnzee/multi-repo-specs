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

openspec-orch doctor [--repo <id>]... [--json]
openspec-orch connect [--workspace <path>]
openspec-orch disconnect

openspec-orch agent setup|status|remove --agent <id>
```

В TTY `init` без полного набора обязательных flags запускает выбор. В non-TTY
нужны `--store` и `--agent`. `doctor` только читает состояние; только итог
`blocked` возвращает exit code 1.

`doctor` по умолчанию печатает человекочитаемый отчёт, а с `--json` — тот же
Diagnostic Report в JSON. Без `--repo` он проверяет основной Store и все Code/Specs Repositories;
повторяемый `--repo <id>` ограничивает только Repository checks. Отчёт включает путь и доступность файлов Repository. Git origin, ветка и чистота
не влияют на доступность. Для linked Store проверяются его Store ID и конфигурация.

Во время обычного вызова Doctor показывает текущую группу проверок в stderr:
в TTY — анимированный индикатор ожидания, при перенаправлении — отдельные строки
без управляющих последовательностей. `--json` отключает эту индикацию.

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
openspec-orch plugin exec --repo <store-id> change-tracking attempt cancel <change-id> <task-id> "Причина отмены"
```

CLI fallback запускается из Code Repository и требует binding `change-tracking` как к
Store, так и к этому Code Repository. Governed MCP attempt tools используют Store
setup-context и не требуют передавать Store path в Agent-сессию.

CodeGraph использует общий `plugin connect/status/sync/exec/disconnect`.

## Project config

`openspec-orch.yaml` поддерживает только version 1:

```yaml
version: 1
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

- `get_status` — при переданном `change_id` включает активные, завершённые и локально отменённые attempts;
- `get_setup_context`;
- `get_change_context` — принимает опциональный `include_assignment: true`, чтобы
  вернуть `assignment_scope` в том же ответе без повторного Project envelope и второй
  компиляции Graph impact. `resources` содержит артефакты выбранного Change,
  `shared_resources` — общие инструкции, контекст и Master Specs Store;
- `get_next_action` — учитывает прогресс Apply перед предложением следующего
  артефакта: незавершённые задачи дают `apply_change`, неизвестный или противоречивый
  прогресс — `consult_change_context`. Доступный Verify предлагается после
  подтверждённого OpenSpec завершения отслеживаемых задач; фактический результат
  реализации и проверки агент дополнительно проверяет по инструкциям Verify;
- `get_assignment_scope`;
- `get_doctor_report`;
- `get_spec_graph` — полный граф выбранного Store;
- `get_spec_graph_node` — узел, его связи и соседи; обязательный `node_id`;
- `get_spec_change_impact` — Specs и Repositories, затронутые Change; обязательный `change_id`.

### Области действия и идентификаторы

MCP закреплён за working directory при запуске. `get_status`, `get_change_context`,
`get_next_action`, `get_assignment_scope`, `get_doctor_report` и `connect_project`
разрешают основной проект из этого каталога. Запуск из Code Repository использует
его основной Store. `get_setup_context` описывает варианты настройки;
`initialize_project` создаёт Store именно в закреплённом каталоге.
`start_attempt` и `complete_attempt` работают с текущим Code Repository и задачей
из основного Store. Чтение другого Store через Graph не переключает эти методы.

Три Graph-метода принадлежат Plugin `openspec-graph`. Их необязательный
`store_repository_id` выбирает checkout с ролью `store`/`specs` и подключённым
`openspec-graph` из `get_status.project.repositories`. Передавайте локальный
`repository_id` записи; вложенный `store_id` может отличаться и не является селектором.
Без аргумента читается основной Store, в том числе из кодового checkout.
Это выбор источника графа, а не фильтр по участвующему в Change кодовому репозиторию.
Неподдерживаемая роль, неизвестный ID и отсутствующее подключение отклоняются.

| Значение | Точный смысл |
|---|---|
| `store_repository_id` | Локальный ID checkout Store в реестре основного проекта |
| `node_id` | Полный `nodes[].id` из графа, например `master-spec:shipping-cost` или `repository:shop` |
| `change_id` | Имя каталога Change, например `free-shipping-threshold`, без префикса `change:` |
| `artifact` | ID артефакта из `openspec_status.artifacts[].id`; `apply` запрашивает инструкции Apply |
| `task_id` | Точная строка `artifact_instructions.tasks[].id`, не номер из Markdown |
| `include_assignment` | Включить сведения о checkout и участии репозиториев; по умолчанию `false`, назначения не создаёт |
| `revision` | В обычном контексте `null`; Git revisions получает только Change Tracking |
| `context_revision` / `if_context_revision` | Хэш ответа / хэш прежнего ответа для проверки свежести, не Git commit |

В provenance Graph/resources поля `revision` и `clean` равны `null`: эти ответы
не выполняют Git-проверок. `content_revision` по-прежнему вычисляется по содержимому.

`get_assignment_scope` перечисляет кодовые checkout. С `change_id` Graph overlay
заполняет `assigned` по Repository Impact; `null` означает, что участие неизвестно.
Это не назначение сотрудника и не подтверждение завершения работы.
`current_repository` обозначает checkout запуска MCP, а `source` внешнего Graph
и ресурса — checkout, из которого прочитаны данные. Графовые `repositories[].id`
имеют префикс `repository:`; ID реестра `project.repositories[].repository_id` — без него.

Примеры:

```json
{"tool":"get_spec_graph","arguments":{}}
{"tool":"get_spec_graph_node","arguments":{"node_id":"repository:shop"}}
{"tool":"get_spec_change_impact","arguments":{"change_id":"free-shipping-threshold"}}
{"tool":"get_spec_graph","arguments":{"store_repository_id":"payments"}}
```

До пилота прежний `query_graph(query, id, repository_id)` заменён этими тремя
методами. Старые имя и аргументы больше не принимаются. Перезапустите Agent/MCP
и обновите собственные skills или скрипты, использовавшие старые вызовы.
Формат Store, CLI и файлы Changes не меняются. Все схемы Graph — обычные объекты
с явно обязательными полями, без корневого `oneOf`.


`resources/list` включает доступные Specs Repositories. Их URI имеют вид
`openspec-orch://project/<owner-id>/repository/<local-id>/<path>`; прежние URI
основного Store сохраняются. `_meta.source` содержит `project_id`, `repository_id`,
`store_id`, `revision`, `clean`, а `_meta.content_revision` — хэш содержимого.
Allowlist файлов тот же, что у основного Store; вложенные подключения не обходятся.
Недоступные или некорректные внешние Store вместо файлов публикуют ресурс
`openspec-orch://project/<owner-id>/repository/<local-id>/$diagnostic`.
Его JSON и `_meta.diagnostic` содержат `project_id`, `repository_id`,
`expected_store_id`, `state: "unavailable"` и `message`; `_meta.content_revision`
содержит хэш диагностики. `_meta.source` отсутствует: идентичность источника
может быть не подтверждена. Ошибка одного внешнего Store не блокирует остальные;
после восстановления диагностика исчезает при следующем запросе. Ошибки основного
Store по-прежнему прерывают запрос. Внешние артефакты не становятся инструкциями
основного проекта. `get_change_context`, `get_next_action` и tracking operations
продолжают работать в прежнем scope основного проекта.

Каждый успешный read-ответ содержит `context_revision`, scoped к имени tool, его
эффективным аргументам и фактически прочитанному результату. Для проверки свежести
клиент передаёт это значение как `if_context_revision`. MCP всё равно перечитывает
текущее состояние; если результат не изменился, он возвращает только
`{ "unchanged": true, "context_revision": "..." }`. Поэтому revision не является
TTL-кэшем и не разрешает переиспользовать payload другого tool или другого набора
аргументов. JSON tool results передаются без форматирующих пробелов.

Controlled setup tools:

- `initialize_project` — только cwd MCP; принимает обязательные
  `store_id`, `agent_id`, опциональный bundled `template_id` и массив
  `repositories` только для Code Repositories с полями `repository_id`, `remote`,
  `default_branch`; центральный Store задаётся только через `store_id` и в этот массив
  не включается;
- `connect_project` — без произвольного workspace.

Перед `initialize_project` клиент должен вызвать `get_setup_context` и подтвердить
возвращённый `cwd`: tool не принимает другой target. Пользовательский сценарий
описан в [руководстве по началу работы](../user/getting-started.md#альтернатива-инициализация-через-mcp).

Task evidence tools:

- `start_attempt` — локально фиксирует task и base revision текущего Code Repository;
- `complete_attempt` — требует выполненный task из OpenSpec Apply и записывает
  итоговую revision в Change-local implementation map; повторная реализация того же
  task добавляется как новая attempt.

Resources ограничены Project config, OpenSpec config, `STORE.md`, точными файлами
`openspec/process/quality-gates.md` и `openspec/process/release-process.md`,
Markdown/YAML context, Master Specs и schema-declared Change artifacts.
Каждый descriptor содержит `_meta.content_revision` — SHA-256 содержимого файла.
`get_change_context` включает эти descriptors, поэтому изменение текста, добавление
или удаление ресурса текущего Change либо общего Store context меняет его
`context_revision`, даже если статус artifact прежний. Изменения артефактов других
Changes не входят в этот набор; Plugin overlays могут иметь собственные зависимости. `.openspec.yaml` и произвольные Store
files не публикуются.

В `get_assignment_scope` поле `assigned` равно `true` или `false`, когда scope
подтверждён подключённым OpenSpec Graph по непустой корректной таблице Repository
Impact текущего Change. Если Graph недоступен, таблица отсутствует или содержит
ошибки, возвращается `null`: участие неизвестно, а не исключено. Диагностика
сохраняется в `graph_impact`; ошибки Repository Impact других Changes не меняют
назначения текущего. Agent проверяет Proposal, доступный как MCP resource,
и уточняет отсутствующие или некорректные назначения перед реализацией.
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

Чтение MCP resource проверяет точный URI и allowlist выбранного файла, затем читает
его один раз; `content_revision` вычисляется из возвращаемого текста. Для артефакта
Change проверяется его собственная schema. Запрос контекста одного Change не разбирает
metadata других Changes; общий список ресурсов по-прежнему сообщает об ошибочной schema.
