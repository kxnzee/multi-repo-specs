# Конфигурация

Переносимая конфигурация проекта хранится в `openspec-orch.yaml` в корне Store.
Поддерживается только `version: 2`.

```yaml
version: 2
strict: true
template:
  id: default
agent:
  id: qwen
extensions:
  - id: openspec-base
    source: bundled:openspec-base
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
| `version` | Версия transport contract; сейчас только `2` |
| `strict` | Проверять Git identity, branch, clean state и pinned revision |
| `template.id` | Применённый Project Template |
| `agent.id` | `claude`, `qwen` или `gigacode` |
| `extensions` | Упорядоченные standalone Extension declarations |
| `plugins` | Установленные Plugin declarations с exact source |
| `repositories` | Один Store и Code Repositories |
| `repositories[].plugins` | Bindings объявленных Plugins |

Должен существовать ровно один Repository с `roles: [store]`. Остальные используют
`roles: [code]`. ID уникальны и имеют lowercase kebab-case.

HTTP(S) credentials, `file://`, локальные абсолютные remote и значения Git,
начинающиеся с `-`, отклоняются.

## Strict и relaxed mode

В strict mode `connect` может клонировать отсутствующий Code Repository, но не
выполняет pull, checkout, reset или merge в существующем checkout. Relaxed mode
требует готовые каталоги `<workspace>/src/<repository-id>` и помечает revision как
`unpinned`.

Флаг `--no-strict` действует на текущий вызов. Он не включает strict, если project
default уже равен `false`.

## Tracked и local state

| Путь | Назначение | Git |
|---|---|---|
| `openspec-orch.yaml` | Project configuration | да |
| `.openspec-store/store.yaml` | Identity Store | да |
| `openspec/` | Specs, Changes, schemas и Template assets | да |
| `tracking/cycles/` | Change Tracking evidence | да |
| `.openspec-orch/state.json` | Выбранный workspace | нет |
| `.openspec-orch/plugins/` | Local Plugin state | нет |
| `.openspec-orch/cache/` | External Plugin runtimes | нет |

Не редактируйте local state вручную. Повреждённый или неизвестный version contract
завершается ошибкой, а не молча мигрируется.
