# Справочник

## Среда выполнения

- Node.js: `>=22.16.0`.
- Исполняемый файл OpenSpec должен быть в `PATH`.
- Core принимает версию OpenSpec в формате SemVer; Change Tracking требует
  `>=1.11.0 <2`.
- Поддерживаемые агенты: `claude`, `qwen`, `gigacode`.

## CLI Core

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

В интерактивном терминале `init` без полного набора обязательных параметров запускает
выбор. Store ID, целевой путь и их локальная регистрация OpenSpec проверяются сразу
после выбора Store, до запросов остальных параметров. При запуске без терминала нужны
`--store` и `--agent`. `doctor` только читает
состояние; только итог `blocked` возвращает код завершения 1.

`doctor` по умолчанию печатает человекочитаемый отчёт, а с `--json` — тот же
диагностический отчёт в JSON. Без `--repo` он проверяет основной Store и все
репозитории с ролями `code` и `specs`; повторяемый `--repo <id>` ограничивает только
проверки репозиториев. Отчёт включает путь и доступность файлов репозитория. Источник
Git, ветка и чистота не влияют на доступность. Для подключённого Store проверяются
его ID и конфигурация.
Для подключённых репозиториев кода Doctor также сравнивает весь доставляемый
пакет агента с текущим пакетом в Store: все команды и навыки OpenSpec. Отсутствующие,
изменённые и больше не поставляемые файлы возвращаются предупреждением
`AGENT_PACK_DRIFT` с точными относительными путями. Doctor ничего не изменяет, а
`connect` не удаляет устаревшие файлы. Пользователь сам решает, что обновлять или удалять.
Если итоговый статус плагина не `ready`, команда завершается ошибкой
`PROJECT_CONNECT_NOT_READY` с указанием привязки и состояния. Уже выполненные
подключения сохраняются; дальнейшая диагностика доступна через `doctor`.

Во время обычного вызова Doctor показывает текущую группу проверок в stderr:
в интерактивном терминале — анимированный индикатор ожидания, при перенаправлении — отдельные строки
без управляющих последовательностей. `--json` отключает эту индикацию.

Корневая команда `disconnect` отключает локальные расширения агента и не меняет
переносимую конфигурацию.

## Жизненный цикл плагинов

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
openspec-orch extension connect <id> [--refresh]
openspec-orch extension status [<id>] [--json]
openspec-orch extension disconnect <id>
openspec-orch extension remove <id>
openspec-orch package sync
openspec-orch package status [--json]
```

Фактические команды плагинов появляются после `plugin init`. Жизненный цикл
самостоятельного расширения выполняется только через группу `extension`; общий
`connect` при необходимости сначала восстанавливает зафиксированную среду npm, затем
все объявленные расширения. Относительный путь в `extension init/update --from`
разрешается от каталога запуска CLI. `update` — единственная операция явной смены
источника пакета; `package status` только читает файл блокировки, происхождение и
локальную среду, сверяя установленную версию и отметку полного файла блокировки
последней успешной установки. Ход выполнения идёт в stderr, машиночитаемый результат —
в stdout.

## Встроенные команды

OpenSpec Graph:

```text
openspec-orch plugin exec openspec-graph inspect [--json]
openspec-orch plugin exec openspec-graph view [--port <port>]
```

Change Tracking:

```text
openspec-orch plugin exec --repo <store-id> change-tracking status <change-id> [--task <task-id>] [--json]
openspec-orch plugin exec --repo <store-id> change-tracking status --all [--json]
openspec-orch plugin exec --repo <store-id> change-tracking status <change-id> --task <task-id> --diff [--json]
openspec-orch plugin exec --repo <store-id> change-tracking start <change-id> <task-id> [--restart]
openspec-orch plugin exec --repo <store-id> change-tracking checkpoint <change-id> <task-id> [--note <text>]
openspec-orch plugin exec --repo <store-id> change-tracking complete <change-id> <task-id>
openspec-orch plugin exec --repo <store-id> change-tracking cancel <change-id> <task-id> "Причина отмены"
```

Запись запускается из репозитория кода через привязку Store. Привязка репозитория
кода доставляет расширение агента. Ни CLI, ни MCP не принимают вручную заданные SHA
или URL PR.

CodeGraph использует общий `plugin connect/status/sync/exec/disconnect`.

## Конфигурация проекта

`openspec-orch.yaml` поддерживает только версию 1:

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

Должен существовать ровно один репозиторий Store. Привязка плагина ссылается на
верхнеуровневое объявление. Поля и локальное состояние описаны в
[справочнике конфигурации](configuration.md).

## MCP

Исполняемый файл `openspec-orch-mcp` обслуживает только stdio.

Шлюз устанавливается отдельно от проекта и плагинов:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Он не предоставляет жизненный цикл плагинов, управление агентом или сетевой
транспорт. После установки или обновления перезапустите агент и долгоживущий
MCP-процесс.

Инструменты чтения:

- `get_status` — при переданном `change_id` подключённый Change Tracking добавляет
  краткий список задач, состояния записей и соответствие рабочей копии без ревизий;
- `get_setup_context`;
- `get_change_context` — принимает опциональный `include_assignment: true`, чтобы
  вернуть `assignment_scope` в том же ответе без повторной оболочки проекта и второй
  компиляции влияния Graph. `resources` содержит артефакты выбранного Change,
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

В Graph активный Change имеет `change_id`, равный имени каталога; архивный —
`archive/YYYY-MM-DD-name`. Этот ID используется в узлах, Delta Specs и
`via_changes`, поэтому повторное имя не объединяет разные экземпляры.
Для `get_spec_change_impact` копируйте точный `nodes[].change_id` из графа.
Обычное имя выбирает активный Change; архивный запрашивается явно с датой.
Это правило относится к Graph, а не к командам OpenSpec или Change Tracking.

### Области действия и идентификаторы

MCP закреплён за рабочим каталогом при запуске. `get_status`, `get_change_context`,
`get_next_action`, `get_assignment_scope`, `get_doctor_report` и `connect_project`
разрешают основной проект из этого каталога. Запуск из репозитория кода использует
его основной Store. `get_setup_context` описывает варианты настройки;
`initialize_project` создаёт Store именно в закреплённом каталоге.
Записывающие инструменты Tracking работают с текущим репозиторием кода и задачей
из основного Store. Чтение другого Store через Graph не переключает эти методы.

Три Graph-метода принадлежат Plugin `openspec-graph`. Их необязательный
`store_repository_id` выбирает рабочую копию с ролью `store`/`specs` и подключённым
`openspec-graph` из `get_status.project.repositories`. Передавайте локальный
`repository_id` записи; вложенный `store_id` может отличаться и не является селектором.
Без аргумента читается основной Store, в том числе из рабочей копии кода.
Это выбор источника графа, а не фильтр по участвующему в Change кодовому репозиторию.
Неподдерживаемая роль, неизвестный ID и отсутствующее подключение отклоняются.

| Значение | Точный смысл |
|---|---|
| `store_repository_id` | Локальный ID рабочей копии Store в реестре основного проекта |
| `node_id` | Полный `nodes[].id` из графа, например `master-spec:shipping-cost` или `repository:shop` |
| `change_id` | Имя каталога Change, например `free-shipping-threshold`, без префикса `change:` |
| `artifact` | ID артефакта из `openspec_status.artifacts[].id`; `apply` запрашивает инструкции Apply |
| `task_id` | Точная строка `artifact_instructions.tasks[].id`, не номер из Markdown |
| `include_assignment` | Включить сведения о рабочей копии и участии репозиториев; по умолчанию `false`, назначения не создаёт |
| `revision` | В обычном контексте `null`; ревизии Git получает только Change Tracking |
| `context_revision` / `if_context_revision` | Хэш ответа / хэш прежнего ответа для проверки свежести, не коммит Git |

В сведениях о происхождении Graph и ресурсов поля `revision` и `clean` равны `null`:
эти ответы не выполняют проверки Git. `content_revision` по-прежнему вычисляется
по содержимому.

`get_assignment_scope` перечисляет рабочие копии кода. С `change_id` дополнение Graph
заполняет `assigned` по Repository Impact; `null` означает, что участие неизвестно.
Это не назначение сотрудника и не подтверждение завершения работы.
`current_repository` обозначает рабочую копию запуска MCP, а `source` внешнего Graph
и ресурса — рабочую копию, из которой прочитаны данные. Графовые `repositories[].id`
имеют префикс `repository:`; ID реестра `project.repositories[].repository_id` — без него.

Примеры:

```json
{"tool":"get_spec_graph","arguments":{}}
{"tool":"get_spec_graph_node","arguments":{"node_id":"repository:shop"}}
{"tool":"get_spec_change_impact","arguments":{"change_id":"free-shipping-threshold"}}
{"tool":"get_spec_graph","arguments":{"store_repository_id":"payments"}}
```

Прежний `query_graph(query, id, repository_id)` заменён этими тремя методами.
Старые имя и аргументы больше не принимаются. Перезапустите агент и MCP, затем
обновите собственные навыки или скрипты, использовавшие старые вызовы.
Формат Store, CLI и файлы Changes не меняются. Все схемы Graph — обычные объекты
с явно обязательными полями, без корневого `oneOf`.


`resources/list` включает доступные репозитории спецификаций. Их URI имеют вид
`openspec-orch://project/<owner-id>/repository/<local-id>/<path>`; прежние URI
основного Store сохраняются. `_meta.source` содержит `project_id`, `repository_id`,
`store_id`, `revision`, `clean`, а `_meta.content_revision` — хэш содержимого.
Список разрешённых файлов тот же, что у основного Store; вложенные подключения
не обходятся.
Недоступные или некорректные внешние Store вместо файлов публикуют ресурс
`openspec-orch://project/<owner-id>/repository/<local-id>/$diagnostic`.
Его JSON и `_meta.diagnostic` содержат `project_id`, `repository_id`,
`expected_store_id`, `state: "unavailable"` и `message`; `_meta.content_revision`
содержит хэш диагностики. `_meta.source` отсутствует: идентичность источника
может быть не подтверждена. Ошибка одного внешнего Store не блокирует остальные;
после восстановления диагностика исчезает при следующем запросе. Ошибки основного
Store по-прежнему прерывают запрос. Внешние артефакты не становятся инструкциями
основного проекта. `get_change_context`, `get_next_action` и операции Tracking
продолжают работать в прежней области основного проекта.

Каждый успешный ответ чтения содержит `context_revision`, привязанный к имени
инструмента, его эффективным аргументам и фактически прочитанному результату.
Для проверки свежести
клиент передаёт это значение как `if_context_revision`. MCP всё равно перечитывает
текущее состояние; если результат не изменился, он возвращает только
`{ "unchanged": true, "context_revision": "..." }`. Поэтому ревизия не является
TTL-кэшем и не разрешает переиспользовать содержимое другого инструмента или другого
набора аргументов. Результаты инструментов в JSON передаются без форматирующих пробелов.

Управляемые инструменты настройки:

- `initialize_project` — только cwd MCP; принимает обязательные
  `store_id`, `agent_id`, необязательный встроенный `template_id` и массив
  `repositories` только для репозиториев кода с полями `repository_id`, `remote`,
  `default_branch`; центральный Store задаётся только через `store_id` и в этот массив
  не включается;
- `connect_project` — без произвольного рабочего пространства.

Перед `initialize_project` клиент должен вызвать `get_setup_context` и подтвердить
возвращённый `cwd`: инструмент не принимает другую цель. Пользовательский сценарий
описан в [руководстве по началу работы](../user/getting-started.md#альтернатива-инициализация-через-mcp).

В `get_status` ошибка дополнения Tracking не скрывает доступный статус Core:
`tracking` становится `null`, а `capabilities.tracking` содержит `available: false`
и `diagnostic` с кодом `TRACKING_STATUS_UNAVAILABLE` и исходным сообщением ошибки.
Прямой `tracking_status` по-прежнему возвращает ошибку при повреждённой карте;
данные автоматически не исправляются.

Инструменты плагина Change Tracking (отсутствуют без подключения):

- `tracking_start` — начать или продолжить задачу; необязательный `restart`;
- `tracking_checkpoint` — сохранить закоммиченный результат; необязательная `note`;
- `tracking_complete` — сохранить ревизию и закрыть локальную сессию независимо от отметки;
- `tracking_cancel` — отменить локальную работу; обязательный `reason`;
- `tracking_status` — отметка из публичного API OpenSpec, наличие ревизии и
  следующие шаги; `task_id` раскрывает задачу,
  `diff: true` с `task_id` добавляет сравнение после последней записи реализации,
  `details: true` добавляет ревизии. `all: true`
  вместо `change_id` возвращает компактный обзор активных Changes.

Записывающие инструменты принимают `change_id` и точный `task_id`. Статус требует
либо `change_id`, либо `all: true`; `all` несовместим с Change, задачей и сравнением.
Без `--all` нужен Change, без задачи нельзя запросить сравнение. Обзор не включает
технические снимки кандидатов. Ревизии Git и маркеры конкурентной записи плагин
получает автоматически.

Ресурсы ограничены конфигурацией проекта и OpenSpec, контекстом Markdown/YAML,
Master Specs и артефактами Change, объявленными схемой. Каждое описание содержит
`_meta.content_revision` — SHA-256 содержимого файла. `get_change_context` включает
эти описания, поэтому изменение текста, добавление или удаление ресурса текущего
Change либо общего контекста Store меняет его `context_revision`, даже если статус
артефакта прежний. Изменения артефактов других Changes не входят в этот набор;
дополнения плагинов могут иметь собственные зависимости. `.openspec.yaml` и
произвольные файлы Store не публикуются.

В `get_assignment_scope` поле `assigned` равно `true` или `false`, когда область
подтверждена подключённым OpenSpec Graph по непустой корректной таблице Repository
Impact текущего Change. Если Graph недоступен, таблица отсутствует или содержит
ошибки, возвращается `null`: участие неизвестно, а не исключено. Диагностика
сохраняется в `graph_impact`; ошибки Repository Impact других Changes не меняют
назначения текущего. Агент проверяет Proposal, доступный как ресурс MCP,
и уточняет отсутствующие или некорректные назначения перед реализацией.
Такая же семантика действует для вложенного `assignment_scope`, если
`get_change_context` вызван с `include_assignment: true`.

MCP не предоставляет проверку результата, Release, Archive, произвольную запись в Git,
жизненный цикл плагинов, управление агентом или сетевой транспорт.

## Коды завершения

- `0` — успешное выполнение;
- `1` — ошибка среды выполнения или проверки;
- `2` — неверный вызов CLI.

Точный набор параметров конкретной установленной версии всегда показывает
`openspec-orch <command> --help`.

Чтение ресурса MCP проверяет точный URI и список разрешённых файлов, затем читает
его один раз; `content_revision` вычисляется из возвращаемого текста. Для артефакта
Change проверяется его собственная схема. Запрос контекста одного Change не разбирает
метаданные других Changes; общий список ресурсов по-прежнему сообщает об ошибочной схеме.
