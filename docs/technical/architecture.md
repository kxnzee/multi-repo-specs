# Архитектура

## Состав дистрибутива

```text
bin/openspec-orch.js                  composition root
├── @openspec-orch/core               generic orchestration
├── @openspec-orch/plugin-sdk         public extension API
├── @openspec-orch/plugin-change-tracking
├── @openspec-orch/plugin-codegraph
├── @openspec-orch/plugin-openspec-graph
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
| Plugin package | Бизнес-логика расширения, package-owned state/template/launcher | Только публичный SDK и собственные dependencies |
| Project Template | Agent mappings, schema, context, process artifacts, required Plugin IDs | Декларативный contract Core |
| OpenSpec | Artifact lifecycle и нормативные Specs/Changes | Внешний executable |

ESLint закрепляет статическую границу: Plugin code не импортирует Core, SDK не
импортирует Core, Core не импортирует конкретные Plugins. Подключение выполняется
через composition root и структурно проверенный Plugin export.

## Путь `init`

```text
CLI input
→ validate Store ID, Agent ID, Repository specs и paths
→ проверить заранее существующий Store target
→ вызвать OpenSpec init с adapter Template
→ применить Project Template безопасным copy engine
→ записать базовый openspec-orch.yaml
→ передать requires.plugins в generic reconciliation
→ разрешить и установить required Plugin packages/templates
→ обновить config точными declarations и required flags
```

Операция должна завершаться fail-closed: path traversal, collision, неизвестный
Plugin, несовместимый Template или частичная Agent integration не выдаются за успех.
Core не делает code-repository clone на этом этапе.

## Путь `connect`

```text
найти Store и прочитать strict config
→ проверить OpenSpec version/register/doctor/context
→ разрешить workspace
→ для каждого Code Repository:
   создать checkout clone только если strict и каталог отсутствует
   проверить identity/branch/clean state в strict
   создать/проверить OpenSpec pointer
→ сохранить явно выбранный strict workspace
```

Существующий checkout никогда не получает `pull`, `checkout`, `reset` или merge.
Relaxed mode требует готовый локальный каталог и пропускает Git pinning.

## Путь Plugin lifecycle

```text
plugin init
→ resolve bundled или materialize external package
→ validate package manifest и structural export
→ применить Agent contribution или Plugin Template
→ сохранить exact declaration

plugin connect
→ выбрать Repository instances
→ создать setup-scoped PluginContext
→ вызвать repository.connect
→ повторно проверить repository.status
→ только после успеха сохранить binding
```

Остальные lifecycle operations используют уже существующий binding. `disconnect`
меняет configuration, но не удаляет tool-owned Repository data. `remove` удаляет
declaration/runtime только после проверки required/bindings и возвращает paths для
ручной очистки delivered assets.

## Команды Plugins

Plugin command grammar строится ограниченным SDK builder и монтируется по умолчанию в
`openspec-orch <plugin-id>`. Composition root может разрешить точный набор root command
paths first-party Plugin, например `graph` или `assign/status/record/verify`.

Универсальный `plugin exec` выбирает Plugin instance и Repository context, но Core не
понимает native grammar. Если существует `repository.exec`, argv передается ему.
Иначе SDK исполняет ту же grammar, которую Plugin зарегистрировал через
`registerCommands`. Аргументы копируются в immutable array.

## Change Tracking path

Change Tracking — Store-scoped Plugin:

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

Repository-scoped adapter вызывает внешний `codegraph` runtime в проверенном cwd,
управляет init/index/status и устанавливает provider-specific MCP/instructions.
Внутренняя модель CodeGraph не импортируется в OpenSpec Graph или Store artifacts.

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
