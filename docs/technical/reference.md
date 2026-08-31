# Точный справочник реализованного контракта

Документ отвечает только на вопросы, которые можно подтвердить текущим кодом. Для
деталей конкретного поведения указаны файлы-владельцы; при конфликте приоритет у кода.

## Состав дистрибутива

| Компонент | Реализованная ответственность | Код-владелец |
|---|---|---|
| Composition root | Проверка Node.js, сборка каталога first-party Plugins, политика root-команд | `bin/openspec-orch.js` |
| Core | `init`, `connect`, `repository status`, Plugin lifecycle, безопасные facades и storage | `packages/core/` |
| Plugin SDK | `definePlugin`, contributions, command builder, progress и contract test kit | `packages/plugin-sdk/` |
| Change Tracking | Cycle Record, Result/Verification Receipts и Snapshot | `plugins/change-tracking/` |
| CodeGraph | Repository lifecycle, launcher нативного CLI и Repository-scoped Agent Extension | `plugins/codegraph/` |
| OpenSpec Graph | Компиляция и проверка Store-level графа OpenSpec, локальный viewer | `plugins/openspec-graph/` |
| Orchestrator MCP | Built-in governed Agent API и Store resources | `packages/mcp/`, `bin/openspec-orch-mcp.js` |
| Default Template | Общие config/context/assets и schemas Base + Superspec | `templates/default/` |
| OpenSpec Base Extension | Project instructions, skills, commands и subagent | `extensions/openspec-base/` |
| Superpowers Extension | Локально vendored общая библиотека skills и bootstrap | `extensions/superpowers/` |
| Agent gateway | Явный user-level setup/status/remove общей MCP Extension | `packages/core/internal/agent-gateway.js`, `extensions/orchestrator-agent/` |
| Agent adapters | Native CLI grammar Claude/Qwen/GigaCode | `agents/*/adapter.js` |

Composition root фактически регистрирует все три Plugin packages. Change Tracking и
OpenSpec Graph получают разрешённые root namespaces (`track/done/status/verify` и
`graph`); остальные команды внешнего Plugin
монтируются под его ID.

## Требования запуска

- Node.js `20.19.0` или новее проверяется до импорта Core и Plugins.
- Внешний executable `openspec` должен находиться в `PATH` для `init`, `connect` и
  `doctor`.
- `openspec-orch-mcp` должен оставаться в `PATH` после user-level `agent setup`, чтобы
  Agent мог запускать локальный stdio server из любого workspace.
- Версия OpenSpec принимается, если `openspec --version` возвращает строку semantic
  version. Core не задаёт общий minimum; Change Tracking требует
  `>=1.11.0 <2` и его JSON status contract.
- Git используется без shell-строк: Core передаёт executable и argv через process
  facade и привязывает вызовы к проверенному checkout.

## Базовая CLI-поверхность

Core всегда объявляет:

```text
openspec-orch init [path] --store <id> --agent <id>
  [--template <id-or-path>] [--extension <id>]... [--no-extensions]
  [--repo <id=remote#branch>]... [--no-strict]
openspec-orch doctor [--json]
openspec-orch connect [--workspace <path>] [--no-strict]
openspec-orch disconnect
openspec-orch agent setup|status|remove --agent <claude|qwen|gigacode>
openspec-orch repository status [--repo <id>]...
openspec-orch plugin register|init|connect|status|sync|exec|disconnect|remove ...
```

`init` имеет два эквивалентных входа. При наличии `--store` и `--agent` используются
только флаги. В TTY отсутствие одного из них включает интерактивный выбор остальных
параметров и подтверждение до мутаций; в non-TTY это стабильная ошибка
`INIT_SELECTION_REQUIRED`.

`doctor` формирует read-only Diagnostic Report из существующих Store/OpenSpec,
Repository, standalone Extension и Plugin status contracts. Human-readable вывод
используется по умолчанию, `--json` печатает тот же report без progress в stdout.
Итоговые состояния: `ready`, `degraded` и `blocked`; только `blocked` возвращает exit
code `1`. Ошибка одного независимого источника не прекращает остальные проверки.

Команды `track`, `done`, `status`, `verify` и `graph` появляются только после
загрузки соответствующих установленных Plugin declarations. Статический `--help` в
неинициализированном checkout поэтому показывает только Core namespaces.

### Strict и relaxed mode

Project default хранится в `openspec-orch.yaml` как `strict`; отсутствие поля означает
`true`. `--no-strict` ослабляет только текущий вызов, но не может включить strict поверх
project default `false`.

В strict mode `connect` может клонировать отсутствующие Code Repositories, проверяет
Git identity, origin, default branch, чистоту и полный SHA-1, затем сохраняет явно
указанный workspace. В relaxed mode клонирование и Git pinning не выполняются:
`<workspace>/src/<repository-id>` должен уже существовать, а ревизия помечается
`unpinned`. Ноль Code Repositories допустимы: Store-level Extensions и Plugin
подключаются без repository clone loop.

## Конфигурация и локальные данные

`openspec-orch.yaml` имеет строгий формат `version: 2`:

```yaml
version: 2
strict: true
template: {id: default}
agent: {id: qwen}
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
    remote: https://example.test/specs.git
    default_branch: main
    plugins: [openspec-graph]
```

Ровно один Repository обязан иметь singleton-role `[store]`; остальные допустимые
singleton-role — `[code]`. ID уникальны и имеют lowercase kebab-case. Plugin binding
может ссылаться только на верхнеуровневую declaration. HTTP(S) credentials, `file://`,
локальные абсолютные remote и Git-аргументы с ведущим `-` отклоняются.

| Путь | Назначение | Переносимость |
|---|---|---|
| `openspec-orch.yaml` | Project configuration и bindings | tracked в Store |
| `.openspec-store/store.yaml` | Identity Store, созданная OpenSpec | tracked в Store |
| `tracking/cycles/<change-id>/cycle.yaml` | Cycle Record | tracked в Store |
| `.openspec-orch/state.json` | Последний strict workspace | локально |
| `.openspec-orch/plugins/<plugin-id>/state.json` | Версионированный envelope Plugin storage | локально |
| `.openspec-orch/cache/plugin-runtimes/<plugin-id>/` | Материализованный внешний Plugin runtime | локально |

Core и Plugin storage отклоняют symlink вместо обычного файла/каталога, валидируют
versioned envelope и используют lock плюс atomic replace для мутаций.

## Plugin Platform

Plugin — ESM package с `package.json`:

```json
{
  "type": "module",
  "exports": "./index.js",
  "openspecOrchestrator": { "apiVersion": 1, "plugin": "./index.js" },
  "peerDependencies": { "@openspec-orch/plugin-sdk": "*" }
}
```

`definePlugin` возвращает immutable объект. Contributions:

- `repository`: обязательные `connect` и `status`, необязательные `sync` и `exec`;
- `commands`: декларативная команда, которую Core монтирует и может исполнять через
  универсальный `plugin exec`;
- `extensions`: один или несколько data-only Extension с package-relative root и
  Store/Repository target; native lifecycle выполняет выбранный Agent;

Standalone Extension выбираются повторяемым `init --extension <id>` и хранятся в
порядке выбора. Повторный `init` без Extension-флагов сохраняет набор, а явный
`--extension`/`--no-extensions` заменяет его без повторного применения Template.
Required Extensions из bundled Template всегда добавляются к выбору. Единственный
bundled Template `default` требует `openspec-base` и `superpowers`, поэтому
`--no-extensions` с ним отклоняется.
Общий `connect` сначала проверяет native CLI и manifests всех выбранных standalone
Extension, затем активирует их в Store scope и восстанавливает Extension
contributions всех сохранённых Plugin bindings. Общий `disconnect` отключает оба вида
локально в обратном порядке, не меняя portable config. Отдельного Extension CLI в
Orchestrator нет: после подключения пользователь запускает глобальный CLI выбранного
Agent напрямую и использует его native lifecycle для ручной диагностики или обновления.
`plugin exec` остаётся отдельным proxy к runtime Plugin.

`plugin init --from` материализует npm-compatible source без lifecycle scripts.
Для нового binding `plugin connect` сначала разрешает и валидирует все Extension
contributions, затем выполняет `repository.connect`, нативно активирует Extensions и
только после общего успеха сохраняет binding. Повторный connect существующего binding
реактивирует Extensions без повторного repository callback. `plugin remove` запрещён
для связанного Plugin.

Для `connect`, `sync`, `exec` и `disconnect` повторяемый `--repo` выбирает точные
instances. `--all` выбирает все подходящие instances и несовместим с `--repo`. Без обоих
селекторов TTY показывает checkbox, а non-TTY завершается ошибкой. Аргументы после `--`
передаются Plugin как непрозрачный argv; progress идёт в stderr, чтобы не загрязнять
machine-readable stdout.

## Change Tracking

Команды Plugin Store-scoped:

```text
track <change-id> [--no-push]
done [--change <change-id>] [--sha <40-char-sha1>]
  [--source <human|agent|ci>] [--no-push]
status [change-id] [--json]
verify <pass|fail> [--change <change-id>]
  [--source <human|ci>] [--note <text>] [--no-push]
```

`track` начинает сбор implementation evidence после того, как нормализованный
`openspec status --change <id> --json` подтверждает готовность `apply.requires` и
всех их транзитивных зависимостей, затем автоматически извлекает Code Repositories
из принятого `Repository Impact`. Он не назначает Tasks и не меняет OpenSpec Apply.
Команда требует OpenSpec `>=1.11.0 <2`, минимум один connected Code Repository, отсутствие
незавершённой Git operation и чистый Store, кроме нормативного файла заменяемого Cycle
Record. `planning_revision` — последний commit, изменявший каталог Planning-артефактов
текущего Change; tracking-коммиты не меняют эту ревизию. Cycle ID всегда
`cycle-<uuid-v4>`.

Вызов `done` без аргументов сопоставляет Repository с активными Cycles по стабильному batch
OpenSpec 1.11 `status --all --json`; обход каталога Changes как отдельный источник
активности не используется.

Вызов `status` без аргументов тем же batch-контрактом получает все активные OpenSpec
Changes и возвращает JSON envelope `changes[]`. Для Change без Cycle элемент содержит
`tracked: false`; для отслеживаемого Change в него накладывается полный текущий evidence.
`status <change-id>` сохраняет подробный JSON одного Change. Поле `release_ready`
истинно только для закоммиченного Cycle, текущего Snapshot и актуальной Verification
Receipt с результатом `pass`; это readiness, а не автоматическое решение о выпуске.

Текущий Cycle читается из файла рабочего дерева Store, а не напрямую из Git object
HEAD. Отдельная `git status -- <cycle-record>` проверка определяет, закоммичен ли этот
файл; незакоммиченный Cycle виден в `status`, но блокирует запись результатов и
`verify`.

Result Receipt принимает только полный lowercase SHA-1, существующий в выбранном
Repository, и не содержит task-статус. Последний Receipt пары Cycle/Repository
заменяется с сохранением истории. `verify` требует implementation revision для каждого
Repository и вычисляет стабильный `snap-v1-<sha256>` из версии контракта, Cycle ID и
отсортированных Repository/SHA/Receipt ID. Он не делает checkout и не запускает тесты.
Verification Receipt относится только к текущему Snapshot.

## OpenSpec Graph и CodeGraph

OpenSpec Graph поддерживает только `graph inspect [--json]` и
`graph view [--port <port>]`. Каждая команда компилирует текущий Store без persisted
index. Repository–Master Spec связи выводятся из структурированного Repository Impact
и Delta Specs активных и архивных Changes; errors и warnings входят в единый report.

CodeGraph поддерживает Store и Code Repository; каждый binding работает только в cwd
своего checkout. `connect` вызывает `codegraph init .`, `sync` —
`codegraph sync .`, `exec` передаёт произвольную native-команду через package-owned
launcher. Перед индексированием `.codegraph/` добавляется в локальный
`.git/info/exclude`; tracked `.gitignore` не меняется. Agent definitions и Extension
manifests поддерживают `qwen`, `claude` и `gigacode`.

После успешного repository lifecycle CodeGraph Plugin передаёт свой `extension/`
общему Agent Adapter. Claude подключает его как local-scope Plugin через bundled
marketplace. Qwen и GigaCode активируют Extension в текущем workspace; если package
ещё не установлен, Adapter один раз устанавливает его в project scope. GigaCode
использует Qwen CLI, но отдельный `gigacode-extension.json`. Disconnect только
деактивирует Qwen-compatible Extension в текущем workspace. MCP запускается в целевом
Code Repository через поставляемый executable `openspec-orch-codegraph`. Корневые
`CLAUDE.md`, `QWEN.md`, `GIGACODE.md` и project MCP settings Plugin больше не
редактирует.

## Orchestrator MCP

Executable `openspec-orch-mcp` обслуживает только stdio. MCP SDK `1.30.0` закреплён
exact-зависимостью workspace package и lock-файлом. Server contract:

- read-only: `get_status`, `get_change_context`, `get_next_action`,
  `get_assignment_scope`, `get_doctor_report`, `get_setup_context`, `query_graph`;
- `get_assignment_scope.assignments[]` проецирует read-only status всех Code
  Repositories: assignment, checkout, revision, clean/connected и диагностическое state;
- controlled write: `initialize_project` только для cwd/strict и `connect_project`
  только без workspace/relaxed overrides; оба делегируют общему `ProjectSetupService`;
- resources: exact allowlist `openspec-orch.yaml`, `openspec/config.yaml`,
  Markdown/YAML context, Master Specs, YAML-журналы Change Tracking и artifacts,
  объявленные schema каждого активного или архивного Change, через
  `openspec-orch://store/` URI; `.openspec.yaml`, чужие workflow-файлы и произвольные
  заметки не публикуются;
- отсутствуют receipt, verification, Release, Archive, произвольный Git write,
  planning write, disconnect, Plugin lifecycle, Agent management и network transport.

`get_doctor_report` использует тот же Core Doctor и ту же distribution composition,
что CLI. Setup handlers и CLI используют одну setup application; остальные handlers
вызывают Core и публичные Plugin application services. Общая standalone Extension
`orchestrator-agent` устанавливается явным `agent setup --agent <id>` один раз в
user scope и поставляет MCP manifests поддерживаемому Agent provider. Tracking overlay
разрешается по установленной declaration без обязательного Store binding; Graph
overlay требует и declaration, и binding Store Repository.

## Project Template

Bundled catalog содержит один Template `default`. Он поставляет общий config/context,
assets и две project-local schemas: короткую `spec-driven-extended` и полную
`superspec-multirepo`. Descriptor требует обе независимо поставляемые Extensions —
`openspec-base` и `superpowers`; init добавляет их в desired composition, а
интерактивные checkbox показывают required choices заблокированными.

OpenSpec выбирает schema на уровне Change и сохраняет её в `.openspec.yaml`, поэтому
Change разных типов сосуществуют в одном Store без merge Templates и без логики
выбора workflow в Core. `spec-driven-extended` имеет Verify artifact, но не Apply artifact;
`superspec-multirepo` сохраняет полный DAG через Apply, Verify и Finalize. Их Verify
templates содержат идентичный `Candidate Verification Contract v1`; дополнительный
Superspec Process Compliance оценивается отдельно.

Зависимости artifacts являются машинным контрактом schema. Общие условия Release и
Archive находятся в поддерживаемом `openspec/config.yaml` под
`operations.archive.guidance`; OpenSpec передаёт их Agent как operation instructions,
а не исполняет как пользовательский Archive hook.

Общий MCP gateway `orchestrator-agent` принадлежит distribution-level Agent setup, а
не Template. Template и Base Extension не обнаруживают конкретные Plugins; runtime
каждого Plugin подключается независимо, а Plugin Agent Extension активируется только
для Plugin, который действительно его поставляет.

Template-правила Planning, Gate, Release и Archive являются политикой создаваемого
проекта. Core их копирует и проверяет структуру, но сам не выполняет реализацию,
проектные тесты, PR, merge, release или Archive.
