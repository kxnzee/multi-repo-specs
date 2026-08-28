# Plugins

Plugin — самостоятельный ESM npm package, который расширяет Orchestrator через
публичный `@openspec-orch/plugin-sdk`. Plugin может добавить repository lifecycle,
CLI grammar и Agent Extension, не изменяя Core.

## Plugins стандартной поставки

| Plugin ID | Scope | Обязательность | Назначение |
|---|---|---|---|
| `openspec-graph` | Store | Опциональный | Компилирует и проверяет текущий граф Store/Repositories/Master Specs/Changes/Delta Specs |
| `change-tracking` | Store и Code Repository | Опциональный | Фиксирует Cycle, Results, Snapshot и результат проверки точного multi-repository candidate; команды Change выполняются в Store scope |
| `codegraph` | Store и Code Repository | Опциональный | Управляет repository-local CodeGraph index, native CLI passthrough и Repository-scoped Agent Extension для навигации по выбранному checkout |

Все три package поставляются как dependencies дистрибутива. Template не
выбирает, не устанавливает и не удаляет Plugins.

## OpenSpec Graph

Основные команды:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph inspect
openspec-orch graph inspect --json
openspec-orch graph view
openspec-orch graph view --port 0
```

`inspect` и `view` каждый раз компилируют текущий Store непосредственно из файлов.
Команда `graph` появляется только после `plugin init`, а её Store-контекст становится
доступен только после `plugin connect openspec-graph --repo <store-id>`.
Прямые Repository–Master Spec связи выводятся из строгой таблицы
`Repository | Capabilities` в Proposal и Delta Specs того же активного или архивного
Change. Связь нейтральна и не утверждает владение или dependency.

После успешного `graph inspect --json` Agent может использовать Graph Report как
навигационную карту Store: переходить от Change к затронутым Master Specs и явно
указанным Repositories, находить активные и архивные подтверждения связи, видеть
`current`/`planned`/`missing` элементы и возвращаться к исходному полю через
provenance. Карта помогает сузить чтение Store и сформулировать точечные вопросы к
Code Repository, но не создаёт новый scope и не доказывает ownership, runtime call
или техническую dependency.

Graph не читает файлы Code Repositories, не вызывает CodeGraph, не редактирует Change
и не запускается фоном.

Стандартные Delta headings `ADDED`, `MODIFIED`, `REMOVED` и `RENAMED` работают без
настройки. Если профиль OpenSpec использует другой язык или форму Markdown heading,
добавьте необязательный `openspec-graph.yaml` в корень Store:

```yaml
version: 1
operation_headings:
  ADDED:
    - "### Добавленные требования"
  MODIFIED:
    - "## Требования изменены"
```

Указывайте полный heading вместе с `#`. Aliases дополняют встроенный набор и одинаково
применяются к активным и архивным Changes. Некорректный конфиг помечает report как
`invalid`; все пользовательские aliases отбрасываются атомарно, а компилятор использует
только встроенные headings. Plugin не создаёт и не изменяет этот файл автоматически.

## Change Tracking

Сначала свяжите Plugin со Store и всеми Code Repositories, которые могут входить в
Cycle:

```bash
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

Основные команды:

```bash
openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id> --json
openspec-orch record assignment <change-id> \
  --repo <repository-id> --commit <full-sha1> \
  --status <completed|failed|blocked> --source <human|agent|ci>
openspec-orch verify <change-id>
openspec-orch record verification <change-id> \
  --result <pass|fail> --source <human|agent|ci>
```

Cycle Record tracked в Store. Results, Snapshots и Verification Receipts локальны и
не переносятся через Git. `verify` только вычисляет идентичность набора версий и не
проводит проверку.

Change Tracking не компилирует и не проверяет OpenSpec Graph и не заменяет OpenSpec
Apply, PR, CI, deployment, QA, Release или Archive.

## CodeGraph

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend --repo backend
openspec-orch plugin status --plugin codegraph
openspec-orch plugin sync codegraph --all
openspec-orch plugin exec codegraph --repo frontend -- status --json
```

`connect` вызывает `codegraph init .`, `sync` — `codegraph index .`, а `exec` передает
argv native runtime через package-owned launcher в cwd выбранного Repository.
`.codegraph/` добавляется в локальный `.git/info/exclude`; tracked `.gitignore` не
изменяется.

CodeGraph можно связать со Store либо Code Repository: каждый binding обслуживает
ровно свой Git checkout и получает собственные index, Extension и MCP scope. Для
поиска implementation evidence обычно выбирают конкретный Code Repository; Store
binding не даёт доступа к файлам соседних Code Repositories.

При `plugin connect` Agent-часть активируется как Repository-scoped Extension:
Claude использует local marketplace. Qwen и GigaCode сначала включают уже установленный
Extension в текущем workspace, а при его отсутствии один раз устанавливают project
Extension; GigaCode использует Qwen CLI с отдельным `gigacode-extension.json`.
Extension содержит общие инструкции и подключает MCP через executable
`openspec-orch-codegraph`; Plugin не дописывает корневые Agent instructions и MCP
settings вручную. `plugin disconnect` сначала отключает Extension в текущем workspace
штатной командой Agent и только затем удаляет binding; установленный Qwen package
остаётся доступным другим Repository.

## Простые MCP

Статический MCP входит в Agent Extension: Claude, Qwen и GigaCode получают его через
собственный native manifest вместе с инструкциями использования. Один Extension может
объявить несколько MCP. Если MCP требует repository lifecycle, состояния или своих
команд, владельцем остаётся Plugin, который поставляет target-scoped Agent Extension.

## Общий lifecycle

```bash
openspec-orch plugin init
openspec-orch plugin connect <plugin-id>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec <plugin-id> --repo <repository-id> -- <command> [args...]
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

Без явного selector интерактивный TTY показывает checkbox. В CI/non-TTY для
`connect`, `sync`, `exec` и `disconnect` задайте повторяемый `--repo` либо `--all`.
`--repo` и `--all` несовместимы. Для `connect` `--all` выбирает все подходящие
Repositories; для остальных операций — все существующие bindings.

Progress идет в `stderr`, поэтому JSON и raw stdout можно перенаправлять. После
`connect` и `sync` Core повторно читает фактический Plugin status.

`disconnect` штатно отключает Plugin-owned Extension и удаляет binding, но не данные
внутри Repository. `remove` требует отсутствия bindings. Для старого явного `agent`
copy API доставленные файлы автоматически не удаляются; CLI перечисляет их для ручной
очистки.

## Внешний Plugin

`--from` принимает один локальный каталог, `.tgz`, Git URL или npm install spec:

```bash
openspec-orch plugin init \
  --plugin dependency-audit \
  --from @company/openspec-plugin-dependency-audit@1.2.0
```

Production dependencies materialize в локальный cache без lifecycle scripts. Точная
package identity сохраняется в `openspec-orch.yaml`. Внешний Plugin использует только
публичный SDK и не импортирует Core internals.

Создание каркаса:

```bash
openspec-orch plugin register dependency-audit
openspec-orch plugin register code-analyzer \
  --profile native --support code --extension
```

Профили:

- `commands` — только namespaced command contribution;
- `repository` — guarded `connect/status` и command grammar;
- `native` — repository lifecycle, native `exec` adapter и launcher.

`--extension` добавляет в Repository/Native Plugin готовый Agent Extension для
Claude, Qwen и GigaCode. Commands-only Plugin не имеет Repository target, поэтому
этот флаг для него недоступен.

Scaffold не возвращает фиктивный `ready`: автор обязан реализовать lifecycle и
проверить package через SDK contract test kit.
