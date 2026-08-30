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
| Base Template | OpenSpec schema/config, context и project assets | `templates/base/` |
| Superspec Template | Multi-repository OpenSpec + Superpowers schema/config и context | `templates/superspec/` |
| OpenSpec Base Extension | Project instructions, skills, commands и subagent | `extensions/openspec-base/` |
| Superpowers Extension | Локально vendored общая библиотека skills и bootstrap | `extensions/superpowers/` |
| Agent adapters | Native CLI grammar Claude/Qwen/GigaCode | `agents/*/adapter.js` |

Composition root фактически регистрирует все три Plugin packages. Change Tracking и
OpenSpec Graph получают разрешённые root namespaces (`assign/status/record/verify` и
`graph`); остальные команды внешнего Plugin
монтируются под его ID.

## Требования запуска

- Node.js `20.19.0` или новее проверяется до импорта Core и Plugins.
- Внешний executable `openspec` должен находиться в `PATH` для `init`, `connect` и
  `doctor`.
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
template: {id: base}
agent: {id: qwen}
extensions:
  - id: openspec-base
    source: bundled:openspec-base
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
Required Extensions из bundled Template всегда добавляются к выбору; для `base` это
`openspec-base`, для `superspec` — `superpowers`. Поэтому `--no-extensions` с этими
Template отклоняется.
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
status <change-id> [--json]
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
`codegraph index .`, `exec` передаёт произвольную native-команду через package-owned
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

## Project Template

Bundled Template catalog содержит default `base` и альтернативный `superspec`.
Base Template поставляет schema `base-v1`, context и project assets, а
`openspec-base` Extension — project commands,
skills, subagent и постоянные инструкции. Эти файлы управляют поведением агента, но не
становятся проверками Core runtime. Base не обнаруживает и не вызывает конкретные
Plugins; runtime каждого Plugin подключается независимо от Template, а Agent Extension
активируется только для Plugin, который действительно его поставляет.

Superspec Template поставляет schema `superspec-multirepo` с полным artifact DAG через
Apply, Verify и Finalize. Descriptor декларативно требует отдельный `superpowers`
Extension; init добавляет его в desired composition, а интерактивный checkbox показывает
required choice заблокированным. Execution выполняется в точных Code Repository scopes,
а external verification и Release сохраняются отдельными gates.

Template-правила Planning, Gate, Release и Archive являются политикой создаваемого
проекта. Core их копирует и проверяет структуру, но сам не выполняет реализацию,
проектные тесты, PR, merge, release или Archive.
