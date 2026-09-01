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
  - id: spec-driven-extended
    source: bundled:spec-driven-extended
  - id: superpowers
    source: bundled:superpowers
plugins:
  - id: openspec-graph
    source: "@openspec-orch/plugin-openspec-graph@1.0.0"
repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: [openspec-graph]
  - id: frontend
    roles: [code]
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
| `extensions` | Упорядоченный массив standalone Extension declarations; по умолчанию пустой |
| `extensions[].id` | Extension ID в lowercase kebab-case |
| `extensions[].source` | Только `bundled:<extension-id>` для той же Extension |
| `plugins` | Массив установленных Plugin declarations; по умолчанию пустой |
| `plugins[].id` | Plugin ID в lowercase kebab-case |
| `plugins[].source` | Exact package identity, сохранённая после установки Plugin |
| `repositories` | Массив Store и Code Repositories |
| `repositories[].id` | Уникальный Repository ID в lowercase kebab-case |
| `repositories[].roles` | Ровно одна роль: `[store]` или `[code]` |
| `repositories[].remote` | Ожидаемый Git `origin` Repository |
| `repositories[].default_branch` | Ожидаемая ветка Repository |
| `repositories[].plugins` | Уникальные bindings только объявленных Plugins; по умолчанию пустой массив |

Должен существовать ровно один Repository с `roles: [store]`. Остальные используют
`roles: [code]`. ID Store и его `remote` должны совпадать с
`.openspec-store/store.yaml`.

HTTP(S) credentials, `file://`, локальные абсолютные remote и значения Git,
начинающиеся с `-`, отклоняются. Неизвестные поля, повторяющиеся ID, повторяющиеся
bindings и ссылка на необъявленный Plugin также завершаются ошибкой.

## Strict и relaxed mode

В strict mode `connect` может клонировать отсутствующий Code Repository из
`remote` и `default_branch`, но не выполняет pull, checkout, reset или merge в
существующем checkout. Для существующего checkout он проверяет:

- каталог является корнем Git Repository, а `origin` совпадает с `remote`;
- текущая ветка совпадает с `default_branch`;
- в рабочем дереве нет изменений, кроме `openspec/config.yaml`, который может быть
  изменён при создании OpenSpec pointer;
- текущий `HEAD` является полной 40-символьной Git revision.

Если новый pointer изменил `openspec/config.yaml`, результат получает статус
`needs_setup_pr`: это изменение нужно опубликовать обычным Git-процессом Repository.

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
| `.openspec-orch/cache/plugin-runtimes/<plugin-id>/` | Runtime внешнего Plugin | нет |
| `.openspec-orch/cache/locks/` | Lock-файлы Core и Plugin operations | нет |

Не редактируйте local state вручную. Неизвестная версия `openspec-orch.yaml`, Core
state или Plugin state завершается ошибкой, а не молча мигрируется.
