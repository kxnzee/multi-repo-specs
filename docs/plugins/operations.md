# Подключение плагинов и расширений

Plugin добавляет к Orchestrator команды, repository lifecycle, состояние и при
необходимости Extension агента. Core проверяет manifest и публичный API, но не
изолирует выполняемый package: подключайте только проверенный immutable source.

Команды Plugin становятся доступны после `plugin init`. Работа с репозиторием
требует отдельного `plugin connect`. Если Plugin поставляет Extension агента, она
подключается и отключается вместе с binding этого репозитория.

Конкретные возможности и команды приведены в каталогах [плагинов](README.md) и
[расширений](../extensions/README.md). Этот документ описывает общий lifecycle.

## Стандартная поставка

| Plugin | Scope | Назначение |
|---|---|---|
| `openspec-graph` | Store и Specs Repository | Проверка графа Store, Changes, Specs и Repository Impact |
| `change-tracking` | Store и Code Repository | Связь задач OpenSpec с ревизиями реализации |
| `codegraph` | Store или Code Repository | Локальный индекс CodeGraph и Extension агента |

Bundled Plugins поставляются вместе с версией Orchestrator. `plugin init` добавляет
стабильный ID в `openspec-orch.yaml`, а `plugin connect` — binding в запись
Repository. Эти изменения относятся к Store: их нужно просмотреть и закоммитить.

Внешние Plugins и standalone Extensions — зависимости private npm-проекта Store.
`package.json` и `package-lock.json` коммитятся, `node_modules` остаётся локальным.
После checkout достаточно выполнить:

```bash
openspec-orch connect
```

Если runtime отсутствует, `connect` восстанавливает его по committed lockfile.
Для диагностики остаются `openspec-orch package sync` и `openspec-orch package status`.

## Standalone Extensions

Standalone Extension управляется через отдельную группу CLI:

```bash
openspec-orch extension init <extension-id> --from <package@version>
openspec-orch extension connect <extension-id>
openspec-orch extension update <extension-id> --from <package@version>
openspec-orch extension status <extension-id>
openspec-orch extension disconnect <extension-id>
openspec-orch extension remove <extension-id>
```

`connect` проверяет Agent CLI и payload. `status` ничего не меняет. `disconnect`
временно отключает Extension, а `remove` после успешного native removal удаляет её
declaration и внешнюю npm-зависимость. Общий `connect` восстанавливает объявленные
Extensions после checkout.

## Общий lifecycle Plugin

```bash
cd /absolute/path/to/store
openspec-orch plugin init --plugin <plugin-id>
openspec-orch plugin connect <plugin-id> --repo <repository-id>
openspec-orch plugin update <plugin-id> --from <package@version>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec --repo <repository-id> <plugin-id> <command>
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

`connect`, `status`, `sync` и `disconnect` относятся к repository contribution.
`plugin exec` запускает команды самого Plugin; `sync` доступен только если Plugin
его объявляет. `update` всегда явный и не выполняется из обычного `connect`.

Для нескольких repositories повторяйте `--repo` или используйте `--all`. Без
selector единственный подходящий Repository выбирается автоматически; в non-TTY
при нескольких вариантах selector обязателен. `status` без `--repo` показывает все
bindings. `remove` разрешён только после удаления всех bindings.

## Проверяемое отключение и удаление

Сначала сохраните состояние, затем снимите bindings и только после этого удалите
declaration Plugin:

```bash
openspec-orch plugin status --plugin <plugin-id> --json
openspec-orch plugin disconnect <plugin-id> --all
openspec-orch plugin status --plugin <plugin-id> --json
git diff -- openspec-orch.yaml
openspec-orch plugin remove <plugin-id>
openspec-orch doctor
```

`disconnect` не удаляет данные, созданные Plugin: например, `.codegraph/` или
Plugin storage. Их миграция и очистка определяются документацией конкретного Plugin.
Если отключение завершилось частично, не запускайте `remove`: сохраните
`doctor --json`, проверьте bindings, повторите `disconnect` адресно и только затем
продолжайте.
