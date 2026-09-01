# Архитектура

OpenSpec Orchestrator — локальный composition layer между центральным OpenSpec Store,
несколькими Code Repositories, выбранным Agent и независимыми Plugins. Он
подготавливает окружение и маршрутизирует интеграции, но не владеет Requirements,
workflow Change, реализацией, проверкой, Release или Archive.

## Физический состав

```text
bin/openspec-orch.js             public CLI adapter
bin/openspec-orch-mcp.js         public MCP stdio adapter
bin/internal/distribution.js     shared distribution composition root
bin/internal/                    protocol-specific runtime adapters
packages/core/                   generic orchestration and safe infrastructure
packages/plugin-sdk/             public Plugin contract
packages/mcp/                    governed MCP protocol and Store resources
plugins/                         first-party Plugin packages
agents/                          Agent definitions and native adapters
extensions/                      bundled standalone Agent payloads
templates/                       bundled copy-only Project Templates
```

`bin/internal/distribution.js` читает root `package.json`, проверяет Node.js,
создаёт каталоги bundled Agents, Extensions, Templates и Plugins, а затем собирает
одну `PluginPlatform`. CLI и MCP используют эту же Platform и общие application
services.

Root `package.json` определяет minimum Node.js, default Template, first-party Plugin
packages и разрешённые для них root commands. Core не импортирует конкретные Plugins;
Plugin packages зависят только от `@openspec-orch/plugin-sdk` и загружаются через
проверенный public contract.

## Направление зависимостей

```text
CLI adapter ─┐
             ├→ distribution composition → Core application services
MCP adapter ─┘                              │
                                            ├→ OpenSpec / Git / filesystem
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
| Plugin SDK | Immutable Plugin API, command grammar, scoped contracts и contract test kit |
| Plugin | Собственные commands, repository lifecycle, domain state и опциональные Agent Extensions |
| Project Template | Copy-only OpenSpec config, project context, schemas и assets |
| Standalone Extension | Agent commands, skills, subagents, hooks и MCP manifests |
| Agent definition/adapter | Provider identity, OpenSpec Agent pack adaptation и native Extension lifecycle |
| MCP package | Fixed tool/resource allowlist, validation и единственный stdio transport |
| OpenSpec | Store identity, Specs, Changes, schemas, status/instructions, Apply и Archive operations |
| Команда | Product decisions, implementation, review, checks, deployment, Release и Archive |

Template не выполняет hooks или произвольный код и не устанавливает Plugins.
Standalone Extension не становится частью Core. Plugin package выполняется как
доверенный in-process код: SDK сужает context, пути и process API, но не является
sandbox.

## Project и Repository resolution

`openspec-orch.yaml` в Store — переносимый Project v1 registry. Он содержит один
Store Repository, Code Repositories, выбранные Template и Agent, standalone
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

`init` принимает существующий обычный каталог — чистый Git root с branch и
`origin`. Для нового Project он:

1. проверяет Store ID, Agent, Template, Repository registry и strict/relaxed mode;
2. строит безопасный план применения Template;
3. устанавливает штатный OpenSpec Agent pack и адаптирует provider-specific layout;
4. создаёт Store через OpenSpec;
5. копирует Template assets;
6. записывает `openspec-orch.yaml` с пустым списком Plugins;
7. проверяет обязательные файлы и каталоги результата.

Операция fail-closed для неизвестных IDs, dirty или неверного Git root, path
traversal, symlink, collisions, неполного Agent pack и попытки перезаписать
отличающийся файл. Повторный `init` проверяет существующий Project и может обновить
явно выбранные standalone Extension declarations, но не применяет Template повторно
и не мигрирует уже скопированные assets.

## Connect

`connect` использует общий `ProjectSetupService`:

1. проверяет native CLI выбранного Agent;
2. разрешает и валидирует Store и Project;
3. регистрирует Store и проверяет OpenSpec context;
4. определяет workspace;
5. проверяет или в strict mode клонирует Code Repositories;
6. создаёт и проверяет OpenSpec pointers;
7. подключает выбранные standalone Extensions;
8. восстанавливает lifecycle доступных Plugin-owned Extensions;
9. проверяет итоговое состояние Extensions и Plugins.

Существующий checkout не получает `pull`, `checkout`, `reset`, merge или другую
скрытую Git mutation. Strict mode проверяет remote, default branch и clean state.
Relaxed mode не клонирует и не pin-ит Git state; явно переданный workspace действует
только в текущем вызове.

Bundled Plugins загружаются из distribution. Внешний runtime хранится локально в
Store cache и обычный `connect` не устанавливает его повторно из source. Если
объявленный Plugin недоступен или повреждён, Core и Doctor продолжают запускаться, а
Plugin отображается как unavailable.

## Plugin Platform

`plugin init` разрешает bundled или external source, материализует package при
необходимости, проверяет manifest, package identity и public API и только после
успеха публикует exact declaration в Project config.

`plugin connect`:

1. создаёт новый Repository-scoped `PluginContext`;
2. выполняет repository contribution;
3. подключает Plugin-owned Extension;
4. сохраняет binding только после полного успеха.

`disconnect` сначала отключает Extension, затем удаляет binding. `remove`
разрешён только без bindings и удаляет declaration/runtime, но не tracked repository
data и не произвольные tool-owned artifacts.

Commands обычно монтируются внутри namespace Plugin. Только first-party Plugins могут
получить явно разрешённые root commands из distribution config. Commands-only Plugin
не требует binding; repository lifecycle работает только с поддерживаемыми roles.

## Опциональные Graph и tracking

- OpenSpec Graph при каждом запросе компилирует текущие Store files в
  детерминированный report. Persisted index отсутствует; Repository Impact создаёт
  связи, но не доказывает ownership, реализацию или deployment.
- CodeGraph обслуживает отдельный локальный `.codegraph/` index каждого binding.
  Его модель и freshness не переносятся в Store.
- Change Tracking хранит активную implementation attempt в локальном Plugin storage,
  а завершённую связь OpenSpec task с planning/base/implementation revisions — в
  Change-local `implementation-map.yaml`.

Change Tracking Extension устанавливается только в подключённые Code Repositories и
использует общий MCP для Store context. Эти Plugins независимы: их отсутствие не
меняет штатный OpenSpec Apply и не отменяет repository checks или evidence.

## Governed MCP

`@openspec-orch/mcp` предоставляет только local stdio transport. Runtime собирается
в public MCP adapter и вызывает те же Core/Plugin application services, что CLI.

Public surface состоит из:

- read tools для status, setup/change context, next action, assignment, Doctor и
  Graph query;
- controlled setup tools `initialize_project` и `connect_project` только для
  strict fixed-cwd flow;
- task evidence tools `start_attempt` и `complete_attempt`;
- read-only Store resources для Project/OpenSpec config, context, Master Specs и
  outputs, объявленных schema конкретного Change.

Resources и tool arguments проверяются fail-closed. MCP намеренно не предоставляет
verification, Feature Acceptance, Release, Archive, arbitrary Git writes, Plugin
lifecycle, Agent management или network transport.

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
