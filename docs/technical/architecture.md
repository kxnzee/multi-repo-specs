# Архитектура

## Состав дистрибутива

```text
bin/openspec-orch.js                  composition root
├── @openspec-orch/core               generic orchestration
├── @openspec-orch/plugin-sdk         public extension API
├── @openspec-orch/plugin-change-tracking
├── @openspec-orch/plugin-codegraph
├── @openspec-orch/plugin-openspec-graph
├── agents/                           definitions и native adapters
├── extensions/                       bundled standalone payloads
└── templates/base/                   default Project Template
```

Composition root проверяет Node.js, собирает каталог bundled Plugins и задает только
distribution policy: package sources и разрешенные root commands. Core не содержит
ветвлений по `change-tracking`, `codegraph` или `openspec-graph`.

## Границы компонентов

| Компонент | Владеет | Разрешенные зависимости |
|---|---|---|
| Core | Project/Repository domain, init/connect, Git/OpenSpec adapters, Plugin host, safe files/storage/process | Node/runtime libraries; не Plugin packages |
| Plugin SDK | Immutable Plugin API, contributions, command builder, progress, contract test kit | Не Core internals |
| Plugin package | Бизнес-логика, package-owned state/launcher и target-scoped Extensions | Только публичный SDK и собственные dependencies |
| Project Template | Copy-only context, custom schema/config и project assets | Декларативный contract Core |
| Agent definition/adapter | OpenSpec adapter, adaptation pack и native Extension routing | Distribution-owned catalog |
| Extension | Workflow payload и простые MCP | Native Agent mechanism |
| OpenSpec | Artifact lifecycle и нормативные Specs/Changes | Внешний executable |

ESLint закрепляет статическую границу: Plugin code не импортирует Core, SDK не
импортирует Core, Core не импортирует конкретные Plugins. Подключение выполняется
через composition root и структурно проверенный Plugin export.

## Путь `init`

```text
CLI input
→ validate Store ID, Agent ID, Repository specs и paths
→ проверить заранее существующий Store target
→ вызвать OpenSpec init с OpenSpec ID выбранного Agent
→ адаптировать созданный OpenSpec pack через Agent Adapter
→ применить Project Template безопасным copy engine
→ разрешить ID/source standalone Extensions из каталога без native Agent mutation
→ записать openspec-orch.yaml v2 с Template, Agent и Extensions
→ вывести явный следующий шаг connect
```

Операция должна завершаться fail-closed: path traversal, collision, неизвестный
Agent/Extension, несовпадающий Template ID или неполный OpenSpec/Agent pack не
выдаются за успех. Plugins на этом этапе не выбираются, а Code Repositories не
клонируются.

## Путь `connect`

```text
найти Store и прочитать strict config
→ выполнить preflight native CLI выбранного Agent
→ проверить OpenSpec version/register/doctor/context
→ разрешить workspace
→ для каждого Code Repository:
   создать checkout clone только если strict и каталог отсутствует
   проверить identity/branch/clean state в strict
   создать/проверить OpenSpec pointer
→ сохранить явно выбранный strict workspace
→ разрешить payload и проверить manifests standalone Extensions для всех Agents
→ активировать standalone Extensions через adapter выбранного Agent
→ восстановить Plugin runtime и contributions сохранённых bindings
→ выполнить итоговый status standalone Extensions, Plugin runtime и contributions
```

Существующий checkout никогда не получает `pull`, `checkout`, `reset` или merge.
Relaxed mode требует готовый локальный каталог и пропускает Git pinning.
Если Code Repositories не объявлены, repository-цикл пуст, а Store, Agent Extensions
и Store-scoped Plugin продолжают подключаться обычным путём.

## Путь Plugin lifecycle

```text
plugin init
→ resolve bundled или materialize external package
→ validate package manifest и structural export
→ сохранить exact declaration

plugin connect
→ выбрать Repository instances
→ создать setup-scoped PluginContext
→ разрешить и проверить все Plugin-contributed Extensions без mutation
→ вызвать repository.connect
→ активировать проверенные Extensions через общий Agent Adapter в target checkout
→ только после успеха сохранить binding
```

Повторный адресный `plugin connect` существующего binding не вызывает
`repository.connect`, но повторно активирует его Extension contributions. Фактический
Plugin/Extension status проверяется отдельной status-командой и общим `connect`.
Остальные lifecycle operations используют уже существующий binding. `disconnect`
сначала нативно отключает Extension contributions, затем меняет configuration, но не
удаляет tool-owned Repository data. `remove` удаляет declaration/runtime только после
проверки bindings. Отдельный root `disconnect` отключает только локальные Agent
Extensions и portable configuration не меняет.

## Команды Plugins

Plugin command grammar строится ограниченным SDK builder и монтируется по умолчанию в
`openspec-orch <plugin-id>`. Composition root может разрешить точный набор root command
paths first-party Plugin, например `graph` или `assign/status/record/verify`.

Универсальный `plugin exec` выбирает Plugin instance и Repository context, но Core не
понимает native grammar. Если существует `repository.exec`, argv передается ему.
Иначе SDK исполняет ту же grammar, которую Plugin зарегистрировал через
`registerCommands`. Аргументы копируются в immutable array.

## Change Tracking path

Change Tracking поддерживает bindings Store и Code Repository, а его Change-команды
получают Store-scoped context:

```text
assign
→ проверить Store/Planning/scope
→ записать tracked Cycle Record

record assignment
→ прочитать current Cycle из working tree
→ проверить committed Cycle и существование SHA в выбранном checkout
→ атомарно обновить local Plugin state

verify
→ потребовать completed Result каждого Repository
→ канонизировать Repository/SHA pairs
→ вычислить snap-v1 SHA-256

record verification
→ связать pass/fail с current Cycle и latest Snapshot
```

Change Tracking не вызывает Graph и не запускает реализацию/проверки. Интеграция с
общим flow происходит через Base Apply skill и plugin-owned Apply context.

## Два графа

### OpenSpec Graph

Store-level compiler читает registry, Master/Delta Specs, active/archive Changes и
структурированный Repository Impact. Каждый `inspect` и `view` формирует новый
детерминированный Graph Report с нодами, связями, diagnostics и summary. Viewer
показывает этот report и не изменяет модель.

### CodeGraph

Repository-scoped adapter вызывает package-owned CodeGraph runtime в проверенном cwd
связанного Store или Code Repository и управляет `init`, `status`, `sync` и native
passthrough. Plugin поставляет Repository-scoped Extension, через который Agent
подключает общие инструкции и MCP. Внутренняя модель CodeGraph не импортируется в
OpenSpec Graph или Store artifacts.

## Безопасные facades

PluginContext предоставляет scoped capabilities вместо прямого доступа к Core:

- Files — проверенные Repository/Store-relative paths;
- Git — ограниченные read operations над выбранным checkout;
- Process — executable + immutable argv, cwd, timeout и redaction;
- Storage — versioned envelope, lock и atomic update;
- Project/Repository handles — только подтвержденная identity и role.

Setup context допускает действия подключения до появления binding; обычный context
требует существующую связь. Store-scoped command может запросить Store context и
отклоняет запуск через Code Repository instance.

## Внешние интеграции

Jira, Zephyr и Confluence не входят в composition root и не имеют adapters в
репозитории. Core не должен получать их API. Будущая интеграция реализуется отдельным
Plugin или сервисом и хранит только производные ссылки/status, не копируя normative
Requirements из OpenSpec.
