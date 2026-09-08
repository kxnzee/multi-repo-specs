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
| `repositories` | Массив Store и Code Repositories |
| `repositories[].id` | Уникальный Repository ID в lowercase kebab-case |
| `repositories[].roles` | Ровно одна роль: `[store]` или `[code]` |
| `repositories[].remote` | Ожидаемый Git `origin` Repository |
| `repositories[].default_branch` | Ветка, которую strict `connect` checkout-ит при clone отсутствующего Repository |
| `repositories[].description` | Необязательное краткое описание назначения, технологий и границ ответственности; непустая строка |
| `repositories[].plugins` | Уникальные bindings только объявленных Plugins; по умолчанию пустой массив |

Должен существовать ровно один Repository с `roles: [store]`. Остальные используют
`roles: [code]`. ID Store и его `remote` должны совпадать с
`.openspec-store/store.yaml`.

HTTP(S) credentials, `file://`, локальные абсолютные remote и значения Git,
начинающиеся с `-`, отклоняются. Неизвестные поля, повторяющиеся ID, повторяющиеся
bindings и ссылка на необъявленный Plugin также завершаются ошибкой.

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

Relaxed mode требует заранее подготовленные каталоги
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
