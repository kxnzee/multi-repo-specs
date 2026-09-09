# Конфигурация

Переносимая конфигурация проекта хранится в `openspec-orch.yaml` в корне Store.
Поддерживается только `version: 1`.

```yaml
version: 1
strict: true
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
| `strict` | Режим `connect` по умолчанию; если поле отсутствует, используется `true` |
| `template.id` | Применённый Project Template |
| `agent.id` | `claude`, `qwen` или `gigacode` |
| `extensions` | Упорядоченный массив standalone Extension ID; по умолчанию пустой |
| `plugins` | Массив Plugin ID; по умолчанию пустой |
| `repositories` | Основной Store и подключённые Code/Specs Repositories |
| `repositories[].id` | Уникальный Repository ID в lowercase kebab-case |
| `repositories[].roles` | Ровно одна роль: `[store]`, `[code]` или `[specs]` |
| `repositories[].store_id` | Обязательный только для `specs` ожидаемый ID подключённого Store |
| `repositories[].remote` | Ожидаемый Git `origin` Repository |
| `repositories[].default_branch` | Ветка, которую strict `connect` checkout-ит при clone отсутствующего Repository |
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
`openspec/config.yaml` без pointer. Его Git origin, Store remote и ожидаемый
`store_id` проверяются. Подключение с remote собственного Store отклоняется.
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
Strict `connect` клонирует отсутствующий checkout; relaxed требует существующий.
В обоих режимах для `specs` проверяется Git identity, возвращаются настоящая
revision и `clean`. Detached HEAD и локальные изменения допустимы: подключение
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

## Strict и relaxed mode

В strict mode `connect` может клонировать отсутствующий Code Repository из
`remote` и `default_branch`, но не выполняет pull, checkout, reset или merge в
существующем checkout. Для существующего checkout он проверяет:

- каталог совпадает с корнем Git Repository, а `origin` соответствует `remote`;
- `HEAD` находится на любой именованной ветке, чтобы `connect` не менял файлы в detached HEAD;
- рабочее дерево чистое, кроме OpenSpec pointer `openspec/config.yaml` и
  доставляемых OpenSpec commands/skills, содержимое которых совпадает с Agent pack
  в Store;
- текущий `HEAD` является полной 40-символьной Git revision.

Если pointer или доставленные commands/skills ещё не приняты в Git, результат
получает статус `needs_setup_pr`. Опубликуйте эти файлы через setup PR Repository.
Повторный `connect` допускает их до принятия PR. Отличающееся содержимое Agent pack
блокирует доставку с `AGENT_PACK_CONFLICT`; сначала согласуйте обновление со Store.

Doctor показывает текущую ветку справочно: не сравнивает её с `default_branch`,
не проверяет имя или pattern и не считает detached HEAD ошибкой read-only
диагностики. Состояние `identity_mismatch` означает, что фактический `origin`
не совпадает с project config.

Git Flow контракт не является частью `openspec-orch.yaml`. Команда заполняет роли
веток, их имена и patterns, направления PR и protection rules в
`openspec/process/release-process.md`. Соблюдение обеспечивают Git-хостинг, CI
и review,
а не Core и не MCP.

Для роли `code` relaxed mode требует заранее подготовленные каталоги
`<workspace>/src/<repository-id>`, не клонирует их и не проверяет Git identity,
ветку, чистоту или revision. В результате branch и revision имеют значение
`unpinned`. Проверка OpenSpec context и создание pointer выполняются в обоих режимах.

Для нового Store `openspec-orch init --no-strict` сохраняет `strict: false` в
`openspec-orch.yaml`. Для `connect` флаг `--no-strict` является только разовым
переопределением текущего вызова. Если project default уже равен `false`, обычный
`connect` также остаётся relaxed.

Strict connect запоминает явно переданный `--workspace` в local state. Relaxed
connect использует workspace только в текущем вызове и не сохраняет его.

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
