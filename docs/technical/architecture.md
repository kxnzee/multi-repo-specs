# Архитектура

OpenSpec Orchestrator — локальный composition layer между центральным OpenSpec Store,
несколькими Code/Specs Repositories, выбранным Agent и независимыми Plugins. Он
подготавливает окружение и маршрутизирует интеграции, но не владеет Requirements,
workflow Change, реализацией, проверкой, Release или Archive.

## Физический состав

```text
bin/openspec-orch.js             public CLI adapter
bin/openspec-orch-mcp.js         public MCP stdio adapter
bin/internal/distribution.js     shared distribution composition root
bin/internal/                    protocol-specific runtime adapters
packages/core/                   generic orchestration and safe infrastructure
packages/extension-sdk/          public declarative Extension contract
packages/plugin-sdk/             public Plugin contract
packages/mcp/                    governed MCP protocol and Store resources
plugins/                         first-party Plugin packages
agents/                          Agent definitions and native adapters
extensions/                      bundled standalone Agent payloads
templates/                       bundled copy-only Project Templates
```

`bin/internal/distribution.js` читает root `package.json`, проверяет Node.js,
создаёт каталоги bundled Agents, Extensions, Templates и Plugins, а затем собирает
одну `PluginPlatform`. CLI загружает Plugins по необходимости, MCP собирает contributions при старте.
Оба используют эту же Platform и общие application
services.

Root `package.json` определяет minimum Node.js, default Template и first-party Plugin
packages. Core не импортирует конкретные Plugins;
Plugin packages зависят только от `@openspec-orch/plugin-sdk` и загружаются через
проверенный public contract.

## Направление зависимостей

```text
CLI adapter ─┐
             ├→ distribution composition → Core application services
MCP adapter ─┘                              │
                                            ├→ OpenSpec / Git / filesystem
                                            ├→ npm package supply → package-lock.json
                                            │                    ├→ Extension manager → Agent adapter
                                            │                    └→ Plugin manager → Plugin host
                                            ├→ Agent adapter → native Agent CLI
                                            └→ Plugin host → scoped PluginContext
                                                              ↓
                                                        Plugin packages
```

Protocol adapters отвечают за presentation и transport, но не дублируют domain
logic. Plugin host знает только SDK contract. OpenSpec остаётся владельцем schemas и
artifact lifecycle; Orchestrator не строит параллельный workflow.

## Границы компонентов

| Компонент | Ответственность |
|---|---|
| Orchestrator Core | Project/Repository model, init/connect, diagnostics, Plugin manager/host, routing и safe infrastructure |
| Extension SDK | Standalone package/descriptor contract и общий data-only Extension definition |
| Plugin SDK | Immutable Plugin API, command grammar, Agent contributions, scoped contracts и contract test kit |
| Plugin | Собственные commands, repository lifecycle, domain state, Agent tools и опциональные Agent Extensions |
| Project Template | Copy-only OpenSpec config, project context, schemas и assets |
| Standalone Extension | Agent commands, skills, subagents, hooks и MCP manifests |
| Agent definition/adapter | Provider identity, OpenSpec Agent pack adaptation и native Extension lifecycle |
| MCP package | Fixed base tool/resource allowlist, validation, Plugin tool routing и единственный stdio transport |
| OpenSpec | Store identity, Specs, Changes, schemas, status/instructions, Apply и Archive operations |
| Команда | Product decisions, implementation, review, checks, deployment, Release и Archive |

Template не выполняет hooks или произвольный код и не устанавливает Plugins.
Standalone Extension не становится частью Core. Plugin package выполняется как
доверенный in-process код: SDK сужает context, пути и process API, но не является
sandbox.

## Project и Repository resolution

`openspec-orch.yaml` в Store — переносимый Project v1 registry. Он содержит один
Store Repository, Code/Specs Repositories, выбранные Template и Agent, standalone
Extensions, Plugin declarations и repository bindings.

Project-scoped операция разрешает Store двумя способами:

1. находит Store среди parent directories текущего пути;
2. из зарегистрированного Code Repository читает config-only OpenSpec pointer и
   проверяет его через официальный OpenSpec context.

Текущий Repository дополнительно сверяется с registry и configured Git remote.
Requirements, Master Specs и Changes существуют только в Store. Code Repository
содержит реализацию, checks и pointer, но не локальные `openspec/specs` или
`openspec/changes`.

## Init

`init` принимает существующий обычный каталог; Git не обязателен. Для нового Project он:

1. проверяет Store ID, Agent, Template и Repository registry;
2. строит безопасный план применения Template;
3. устанавливает штатный OpenSpec Agent pack и адаптирует provider-specific layout;
4. создаёт Store через OpenSpec;
5. копирует Template assets;
6. записывает `openspec-orch.yaml` с пустым списком Plugins;
7. проверяет обязательные файлы и каталоги результата.

Операция fail-closed для неизвестных IDs, path traversal, symlink, collisions, неполного Agent pack и попытки перезаписать
отличающийся файл. Повторный `init` проверяет существующий Project и может обновить
явно выбранные standalone Extension declarations, но не применяет Template повторно
и не мигрирует уже скопированные assets.

## Connect

`connect` использует общий `ProjectSetupService`:

1. разрешает и валидирует Store и Project;
2. проверяет npm lock и при отсутствующем runtime восстанавливает его через `npm ci`;
3. проверяет native CLI выбранного Agent;
4. регистрирует Store и проверяет OpenSpec context;
5. определяет workspace;
6. использует существующие каталоги или клонирует отсутствующие Code/Specs Repositories;
7. создаёт и проверяет OpenSpec pointers и доставляет Agent pack только в Code Repositories;
8. подключает выбранные standalone Extensions;
9. догружает и восстанавливает lifecycle Plugin-owned Extensions;
10. проверяет итоговое состояние Extensions и Plugins.

Specs Repositories размещаются в `linked-specs/<id>`. Для них connect проверяет
соответствие Store metadata ожидаемому `store_id` и читает дочерний реестр как данные. Он не разворачивает
репозитории, пакеты или окружение команды и не регистрирует внешний Store.

Существующий checkout не получает `pull`, `checkout`, `reset`, merge или другую
скрытую Git mutation. Существующий каталог определяется по Project registry и
Workspace без Git identity. Чистота Git проверяется только в Change Tracking при
фиксации исходного снимка и завершённой реализации. Workspace сохраняется после
успешного подключения. Конфликты pointer и Agent pack блокируются независимо от Git.

Bundled Plugins загружаются из distribution. Внешние Plugins и standalone Extensions
живут в одном npm-проекте `.openspec-orch/packages`: manifest и lockfile переносимы,
а `node_modules` локален. Обычный `connect` запускает `npm ci` только когда runtime
отсутствует или не соответствует полному committed lockfile; `package sync`
позволяет сделать это явно. Если
объявленный Plugin недоступен или повреждён, Core и Doctor продолжают запускаться, а
Plugin отображается как unavailable.

## Plugin Platform

`plugin init` разрешает bundled или external source, передаёт внешний dependency npm,
проверяет manifest, package identity и public API и только после успеха публикует
стабильный Plugin ID в Project config. Extension Manager использует тот же package
supply, но проверяет декларативный payload через Extension SDK и не выполняет его код.

`plugin connect`:

1. создаёт новый Repository-scoped `PluginContext`;
2. выполняет repository contribution;
3. подключает Plugin-owned Extension;
4. сохраняет binding только после полного успеха. При batch-ошибке Core откатывает
   уже подключённые Agent Extensions в обратном порядке и не публикует bindings.

Граница этой гарантии — состояние, которым владеет Core: bindings и Agent Extensions.
Произвольные side effects стороннего `repository.connect` через `files` или `process`
не являются транзакционными: Plugin SDK не может безопасно определить, какие внешние
данные допустимо удалить при компенсации.

`disconnect` сначала отключает Extension, затем удаляет binding; при ошибке Core
повторно подключает уже отключённые Extensions и сохраняет прежние bindings. `remove`
разрешён только без bindings и удаляет declaration/dependency, но не tracked repository
data и не произвольные tool-owned artifacts.

Все Plugin commands выполняются через `plugin exec`; Core не продвигает их в root CLI
и не содержит исключений для конкретных Plugin IDs. Commands-only Plugin не требует
binding; repository lifecycle работает только с поддерживаемыми roles.

## Опциональные Graph и tracking

- OpenSpec Graph при каждом запросе компилирует текущие Store files в
  детерминированный report. Persisted index отсутствует; Repository Impact создаёт
  связи, но не доказывает ownership, реализацию или deployment.
- CodeGraph обслуживает отдельный локальный `.codegraph/` index каждого binding.
  Его модель и freshness не переносятся в Store.
- Change Tracking хранит переносимые связи задачи с PR/планом и явными SHA в
  Change-local `implementation-map.yaml`; новый путь не использует локальные attempts.
  Для совместимости прежний процесс хранит активную implementation attempt в локальном Plugin storage,
  а завершённую связь OpenSpec task с planning/base/implementation revisions — в
  Change-local `implementation-map.yaml`.

Change Tracking Extension устанавливается только в подключённые Code Repositories и
использует общий MCP для Store context. Эти Plugins независимы: их отсутствие не
меняет штатный OpenSpec Apply и не отменяет repository checks или evidence.

## Governed MCP

`@openspec-orch/mcp` предоставляет только local stdio transport. Runtime собирается
в public MCP adapter и вызывает те же Core/Plugin application services, что CLI.
Base tools принадлежат MCP package; optional Agent tools и overlays обнаруживаются
через универсальный Plugin contribution без импорта конкретных Plugin applications.
При старте adapter объединяет contributions bundled Plugins с contributions внешних
Plugins, которые загружены из Store package runtime.

Public surface состоит из:

- base read tools для status, setup/change context, next action, assignment и Doctor;
- optional read tools, поставляемые owning Plugins, включая Graph query;
- controlled setup tools `initialize_project` и `connect_project` только для
  fixed-cwd flow;
- `record_implementation` для передачи частичной/завершённой реализации;
- прежние task evidence tools `start_attempt` и `complete_attempt`;
- read-only Store resources для Project/OpenSpec config, context, Master Specs и
  outputs, объявленных schema конкретного Change.

Resources и tool arguments проверяются fail-closed. Схемы аргументов внешних
Agent tools проверяются JSON Schema validator из MCP SDK, включая вложенные
объекты, required, числовые ограничения и массивы. MCP намеренно не предоставляет
verification, Feature Acceptance, Release, Archive, arbitrary Git writes, Plugin
lifecycle, Agent management или network transport.

Read tools возвращают scoped `context_revision`. Conditional read с
`if_context_revision` не доверяет локальному TTL и заново разрешает Project, Repository
и Plugin state; при совпадении сервер сокращает ответ до `unchanged`. Для Apply
`get_change_context(include_assignment: true)` собирает Change и assignment одним
runtime-вызовом, а Graph contribution использует один Change impact и для context, и
для assignment projection.

## Safe infrastructure

Plugin получает новый scoped context для каждого invocation:

- immutable Project, Repository и invocation handles без раскрытия checkout paths;
- Files facade для безопасных relative paths и атомарного read-modify-write;
- read-only Git facade;
- ограниченный OpenSpec facade;
- Process facade с фиксированным cwd, immutable argv, timeout и redaction;
- versioned Plugin storage, Agent identity и logger.

Core local state содержит только workspace metadata. Business state Plugins хранится
в отдельных versioned envelopes. Mutations используют fail-closed locks и atomic
replace; corruption, неизвестная версия, path escape и symlink отклоняются.

## Архитектурные инварианты

- Core остаётся generic и не знает конкретные schemas, Plugins или product process.
- OpenSpec владеет Requirements и Change workflow; Store является единственным
  нормативным местом для Specs и Changes.
- Template владеет копируемыми project assets, Extension — Agent workflow assets,
  Plugin — своим runtime/state.
- CLI и MCP используют общие application services и не реализуют независимые
  варианты init, connect, Graph или Change Tracking.
- Опциональный Plugin не становится обязательным условием обычного Apply.
- Agent, Orchestrator и Plugins не принимают человеческие gates и не выполняют
  Release или Archive автоматически.


При повторной загрузке Plugin Loader сверяет содержимое package (включая helper
modules) и доступный npm lock с уже импортированным module graph. Изменение требует
перезапуска процесса с `PLUGIN_LOAD_INVALID`, чтобы не выполнить устаревший export
из ESM cache. Это проверка согласованности процесса, а не sandbox или проверка
целостности произвольных файлов всей машины. CLI не импортирует старые Plugins
перед package mutation; Doctor и lifecycle загружают их по необходимости.
