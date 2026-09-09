# Конфигурация

Переносимая конфигурация проекта хранится в `openspec-orch.yaml` в корне Store.
Поддерживается только `version: 1`.

```yaml
version: 1
template:
  id: default
agent:
  id: qwen
extensions:
  - spec-driven-extended
  - superpowers
plugins:
  - openspec-graph
repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: [openspec-graph]
  - id: frontend
    roles: [code]
    description: >-
      Личный кабинет клиента: заказы, оплата и история покупок.
      React, TypeScript. Обработка платежей находится в backend.
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
    plugins: []
```

## Поля

| Поле | Смысл |
|---|---|
| `version` | Версия transport contract; сейчас только `1` |
| `template.id` | Применённый Project Template |
| `agent.id` | `claude`, `qwen` или `gigacode` |
| `extensions` | Упорядоченный массив standalone Extension ID; по умолчанию пустой |
| `plugins` | Массив Plugin ID; по умолчанию пустой |
| `repositories` | Основной Store и подключённые Code/Specs Repositories |
| `repositories[].id` | Уникальный Repository ID в lowercase kebab-case |
| `repositories[].roles` | Ровно одна роль: `[store]`, `[code]` или `[specs]` |
| `repositories[].store_id` | Обязательный только для `specs` ожидаемый ID подключённого Store |
| `repositories[].remote` | Источник клонирования Code/Specs; необязателен для основного Store |
| `repositories[].default_branch` | Ветка, которую `connect` checkout-ит при clone отсутствующего Repository |
| `repositories[].description` | Необязательное краткое описание назначения, технологий и границ ответственности; непустая строка |
| `repositories[].plugins` | Уникальные bindings только объявленных Plugins; по умолчанию пустой массив |

Должен существовать ровно один Repository с `roles: [store]`. Остальные используют
`roles: [code]` или `roles: [specs]`. ID основного Store и его `remote` должны совпадать с
`.openspec-store/store.yaml`.

HTTP(S) credentials, `file://`, локальные абсолютные remote и значения Git,
начинающиеся с `-`, отклоняются. Неизвестные поля, повторяющиеся ID, повторяющиеся
bindings и ссылка на необъявленный Plugin также завершаются ошибкой.

## Подключённые Store: роль specs

Руководитель может подключить Store нескольких команд к своему проекту. Каждый
из них остаётся самостоятельным Store для своей команды. Основной Store текущего
проекта по-прежнему один; отдельного списка связей или родительских указателей нет.

Добавьте запись в `repositories` основного `openspec-orch.yaml`:

```yaml
  - id: payments
    roles: [specs]
    store_id: team-payments
    remote: ssh://git.example.org/payments/specs.git
    default_branch: main
    plugins: []
```

`id` — локальное имя подключения, `store_id` — ID из
`.openspec-store/store.yaml` команды. Подключаемый репозиторий должен содержать
совместимые Store metadata, `openspec-orch.yaml` и собственный
`openspec/config.yaml` без pointer. Проверяется ожидаемый `store_id`,
но не Git origin. Подключение с remote собственного Store отклоняется.
Разные Store могут иметь одинаковый внутренний ID: их различают remote и
локальные имена подключений.

Из основного Store выполните:

```bash
openspec-orch connect
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo payments
openspec-orch plugin exec --repo payments openspec-graph inspect --json
openspec-orch plugin exec --repo payments openspec-graph view
```

Указывайте `--repo` до аргументов команды плагина. Если Graph уже инициализирован
в проекте, повторять `plugin init` не требуется. При нескольких привязках CLI
предлагает выбор в TTY; вне TTY нужны `--repo` или `--all`.

Checkout размещается в `<workspace>/linked-specs/payments`. Этот каталог отделён
от основного Store, который часто называется `specs`, и от `src` с кодом.
`connect` клонирует отсутствующий checkout. Для существующего каталога проверяются
Store ID и файлы конфигурации. Git origin, ветка и чистота не проверяются; подключение
читает текущий checkout и не записывает в него pointer, Agent pack или Extensions.
Повторное подключение не выполняет pull. Актуальность относительно remote
нужно обеспечить обычным Git-процессом команды.

Реестр команды читается как данные. Перечисленные в нём Code/Specs Repositories
не клонируются, пакеты и Extensions команды не устанавливаются, её Store не
регистрируется глобально. `doctor` показывает недоступность или `invalid_specs`
для некорректного внешнего Store; отсутствие его кодовых checkout не является ошибкой.
Поле `openspec/config.yaml.schema` должно содержать корректный идентификатор схемы.
Ошибка одного внешнего Store не блокирует MCP-ресурсы остальных: вместо его файлов
публикуется диагностический ресурс с причиной ошибки. После исправления следующий
запрос снова возвращает доступные файлы.

Плагины устанавливаются в основном проекте и должны явно поддерживать `specs`.
Из bundled Plugins эту роль поддерживает OpenSpec Graph. Он использует собственный
реестр команды и строит отдельный граф выбранного Store. Роль `specs` не является
песочницей: произвольный установленный Plugin остаётся доверенным кодом.

В MCP `get_spec_graph`, `get_spec_graph_node` и `get_spec_change_impact` принимают
`store_repository_id: "payments"`; без селектора они работают с основным Store. Внешние ресурсы имеют отдельные URI и метаданные
источника. Они служат командным контекстом, а не автоматически применяемыми
инструкциями текущего проекта. Для действий от имени команды запускайте отдельную
сессию в её Store; выбор `--repo payments` не переключает владельца проекта.

Межкомандные инициативы можно описывать в основном Store с учётом подключённых
спецификаций. Автоматическая передача intent, создание дочерних Changes,
наследование настроек и объединение графов в эту возможность не входят.

Существующие конфигурации `store + code` сохраняют `version: 1` и не требуют
миграции. Перед добавлением `specs` обновите Orchestrator у участников текущего
проекта: старый runtime отклонит неизвестные роль и поле `store_id`.

## Описание репозитория для агента

Команда заполняет `repositories[].description` вручную в `openspec-orch.yaml`
в Store: при настройке проекта или позже. Ориентир — 2–4 предложения:
назначение, основные технологии, границы ответственности. Если описание пока
не готово, пропустите поле; пустая строка и `null` не допускаются.

Агента можно попросить подготовить черновики по README, манифестам и структуре
кода и записать их после согласования. Команда поддерживает актуальность описаний
и проверяет изменения обычным review в Store. `init`, `connect` и `doctor`
не генерируют и не обновляют описания автоматически. Отдельной команды генерации нет.

Описание передаётся в `project.repositories[].description` общего контекста MCP,
включая `get_status` и `get_change_context`. Оно помогает агенту выбрать репозитории
для исследования; фактическое влияние изменения нужно проверять по коду.

Конфиги без поля продолжают работать с `version: 1`. Старые версии Orchestrator,
которые ещё не знают `description`, отклонят его как неизвестное поле: перед
добавлением поля обновите Orchestrator у участников проекта.

## Preflight и выполнение Apply

В `spec-driven-extended` skill Apply Context проверяет Planning и repository scope
и возвращает `apply_scope`. Формирование `task_evidence`, проверка результата перед
checkbox и итоговый `repository_completion` относятся к `apply.instruction` схемы.
Штатный Apply получает эти правила из OpenSpec вместе с задачами; preflight
не выполняет реализацию и не формирует отчёт о её завершении.

При обновлении существующего Store перенесите изменение `apply.instruction`
в его локальную схему с сохранением собственных правил: обновление Extension
не заменяет скопированную схему Store автоматически.

## Правила при делегировании

В Superpowers родитель передаёт исполнителю и reviewer применимые инструкции
проекта, Extensions и Plugins в блоке Global Constraints вместе с требованиями
задачи. Передаётся текст правил с областью действия, порядком вызова инструментов
и допустимыми fallback, включая инструкции, доступные только в сессии родителя.
Чтение файлов checkout не заменяет эту передачу. Если нужный инструмент недоступен
и правило не предусматривает fallback, сабагент сообщает об этом родителю.
Правила передаются также при исправлениях и повторном review; они не расширяют
согласованную область задачи или ревью.

## Git и локальные изменения

Orchestrator работает в одном режиме. Флаги `--strict` / `--no-strict` отсутствуют.
Старое поле `strict` в Project v1 принимается, игнорируется и не сохраняется при
следующей записи конфигурации. Версия Project при этом не меняется.

`init`, `connect`, чтение контекста, Graph, MCP resources, Extensions и package
lifecycle не требуют чистого Git, origin или именованной ветки. Основной Store
может быть обычным каталогом; его `remote` и `default_branch` необязательны.
У Code/Specs эти поля задают источник и ветку только для клонирования отсутствующего
каталога. Существующие каталоги не обновляются через pull, checkout, reset или merge.

Чистота нужна только Change Tracking: `attempt start` требует чистый Code и
закоммиченные файлы выбранного Change в Store; первичный `attempt complete` — чистый
Code, новый commit и продолжение истории от base revision. `attempt cancel` и
очистка локального состояния после уже записанного результата Git не проверяют.
Ошибка чтения Git при Tracking не считается чистым состоянием.

`assignment_scope` передаёт repository-id, checkout и доступность каталога.
Его `revision: null` и `clean: null` не блокируют scout или Apply preflight:
они проверяют назначенную область, а evidence scout относится к текущим прочитанным
файлам. При изменении относящихся к вопросу файлов вывод нужно актуализировать.

Запись пользовательских файлов защищают проверки путей и конфликтов содержимого.
`AGENT_PACK_CONFLICT` сохраняется. `connect` возвращает `files_changed`, если в этом
вызове созданы pointer или Agent pack; повторное подключение совпадающих файлов
возвращает `ready` независимо от коммитов. Поля `pointer_pending` и
`agent_pack_pending` теперь обозначают создание файлов в этом вызове, а не состояние PR.

Явный `--workspace` сохраняется после успешного подключения и используется в
следующих вызовах. Изменяемый источник пакета остаётся предупреждением Doctor;
проверки lockfile и наличия runtime выполняются независимо от Git.

Git Flow, ветки и направления PR принадлежат процессу команды, описанному в
`openspec/process/release-process.md`.

## Tracked и local state

| Путь | Назначение | Git |
|---|---|---|
| `openspec-orch.yaml` | Project configuration | да |
| `.openspec-store/store.yaml` | Identity Store | да |
| `openspec/` | Specs, Changes, schemas и Template assets | да |
| `openspec/changes/<change-id>/implementation-map.yaml` | Завершённые task attempts | да |
| `.openspec-orch/state.json` | Версия Core state и запомненный workspace | нет |
| `.openspec-orch/plugins/<plugin-id>/state.json` | Versioned local state конкретного Plugin | нет |
| `.openspec-orch/packages/package.json` | npm-зависимости и соответствие package к Plugin/Extension ID | да |
| `.openspec-orch/packages/package-lock.json` | Точные версии полного npm dependency graph | да |
| `.openspec-orch/packages/node_modules/` | Локальный runtime внешних packages | нет |
| `.openspec-orch/cache/locks/` | Lock-файлы Core и Plugin operations | нет |

После checkout `openspec-orch connect` при необходимости использует `npm ci` и не
меняет committed manifests. То же восстановление можно вызвать явно командой
`openspec-orch package sync`; `package status` остаётся read-only. Не редактируйте
local state вручную. Неизвестная
версия `openspec-orch.yaml`, Core state или Plugin state завершается ошибкой, а не
молча мигрируется.
