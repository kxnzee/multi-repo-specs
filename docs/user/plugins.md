# Plugins

Plugin — самостоятельный ESM npm package, который расширяет Orchestrator через
публичный `@openspec-orch/plugin-sdk`. Plugin может добавить repository lifecycle,
CLI grammar и Agent Extension, не изменяя Core.

## Plugins стандартной поставки

| Plugin ID | Scope | Обязательность | Назначение |
|---|---|---|---|
| `openspec-graph` | Store | Опциональный | Компилирует и проверяет текущий граф Store/Repositories/Master Specs/Changes/Delta Specs |
| `change-tracking` | Store и Code Repository | Опциональный | Фиксирует implementation revisions, собирает точную multi-repository версию и связывает с ней проверку |
| `codegraph` | Store и Code Repository | Опциональный | Управляет repository-local CodeGraph index, native CLI passthrough и Repository-scoped Agent Extension для навигации по выбранному checkout |

Все три package поставляются как dependencies дистрибутива. Template не
выбирает, не устанавливает и не удаляет Plugins.

Ошибка автоматической загрузки одного установленного Plugin не блокирует Core CLI.
Core и `doctor` продолжают запускаться, а команды неисправного Plugin не монтируются;
его bindings отображаются диагностикой как `unavailable`. Восстановление выполняется
через `plugin init --plugin <id> [--from <source>]`, без удаления Store-конфигурации.

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

Сначала свяжите Plugin со Store и всеми Code Repositories, чьи implementation
revisions могут войти в evidence:

```bash
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

Change Tracking не читает метаданные Project Template, не выбирает внешний Apply
workflow и не устанавливает Agent Extension. Его CLI и Store-файлы образуют
самостоятельный evidence-контракт после явного подключения Plugin. Требуется OpenSpec
`>=1.11.0 <2`.

Основные команды:

```bash
openspec-orch track <change-id>
openspec-orch done
openspec-orch verify pass
openspec-orch status <change-id>
```

`track` сначала читает artifact graph через `openspec status --change <id> --json` и
начинает сбор implementation evidence только когда готовы `apply.requires` и все их
транзитивные зависимости. Затем команда читает строгую таблицу `Repository Impact`
из Proposal и фиксирует scope указанных там Code Repositories. Команда не
назначает Tasks, не означает «взять задачу в работу» и не меняет OpenSpec Apply. Она
сама создаёт tracking-коммит и публикует его в Store. `done` вызывается из каталога
Code Repository, требует чистое рабочее дерево и в счастливом пути сам выбирает
единственный активный Change и текущий `HEAD`. При нескольких активных Changes укажите
`--change`; список активных Changes берётся одним batch-вызовом OpenSpec 1.11
`status --all --json`. `--sha` оставлен как аварийный override. Если commit не входит ни в одну
локально известную remote-tracking ветку, команда предупреждает, что команда
разработки может не видеть этот SHA.

`done` передаёт только implementation revision. Выполнение Tasks, блокировки и
неуспешная реализация остаются в нативных артефактах и workflow OpenSpec; Plugin не
создаёт для них параллельные статусы.

Последний `done` автоматически собирает точную версию. После её реальной проверки
человек или CI вызывает `verify pass` либо `verify fail`. Новый `done` меняет версию,
и прежняя проверка становится устаревшей. Plugin не запускает тесты, deployment или
checkout самостоятельно.

Всё командное состояние хранится в Store: `tracking/cycles/<change-id>/cycle.yaml`,
`receipts/<repository-id>.yaml` и `verification/<snapshot-id>.yaml`. Receipt-файл —
append-only журнал; исправление добавляет запись `supersedes`, а не переписывает
evidence. Snapshot не хранится отдельно: он детерминированно вычисляется из текущих
receipts, поэтому любая новая текущая receipt — в том числе исправление через
`supersedes` при том же SHA — создаёт новый хэш и делает прежнюю verification
устаревшей.

`track`, `done`, `verify pass|fail` и `status` скрывают pull/push и используют
говорящие commit messages. `--no-push` оставляет tracking-коммит локально. При
одновременной записи разных repository-файлов Plugin один раз повторяет push после
rebase; конфликт одного файла возвращает `TRACKING_CONFLICT` для решения человеком.
Видимость обновляется по pull, права совпадают с правами на Store. Сервер понадобится
только при требованиях к частым конкурентным записям, real-time или тонкому access
control.

Та же файловая раскладка доступна CLI, Agent/MCP и CI. Публичный контракт Plugin
ограничен командами `track`, `done`, `status` и `verify pass|fail`; CI передаёт SHA
через `done --sha <hash> --source ci`, а результат проверки — через
`verify pass|fail --source ci`.

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
