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
| OpenSpec Base Extension | Project instructions, skills, commands и subagent | `extensions/openspec-base/` |
| Superpowers Extension | Локально vendored общая библиотека skills и bootstrap | `extensions/superpowers/` |
| Agent adapters | Native CLI grammar Claude/Qwen/GigaCode | `agents/*/adapter.js` |

Composition root фактически регистрирует все три Plugin packages. Change Tracking и
OpenSpec Graph получают разрешённые root namespaces (`assign/status/record/verify` и
`graph`); остальные команды внешнего Plugin
монтируются под его ID.

## Требования запуска

- Node.js `20.19.0` или новее проверяется до импорта Core и Plugins.
- Внешний executable `openspec` должен находиться в `PATH` для `init` и `connect`.
- Версия OpenSpec принимается, если `openspec --version` возвращает строку semantic
  version. Минимальный номер и exact pin кодом не заданы.
- Git используется без shell-строк: Core передаёт executable и argv через process
  facade и привязывает вызовы к проверенному checkout.

## Базовая CLI-поверхность

Core всегда объявляет:

```text
openspec-orch init [path] --store <id> --agent <id>
  [--template <id-or-path>] [--extension <id>]... [--no-extensions]
  [--repo <id=remote#branch>]... [--no-strict]
openspec-orch connect [--workspace <path>] [--no-strict]
openspec-orch disconnect
openspec-orch repository status [--repo <id>]...
openspec-orch plugin register|init|connect|status|sync|exec|disconnect|remove ...
```

`init` имеет два эквивалентных входа. При наличии `--store` и `--agent` используются
только флаги. В TTY отсутствие одного из них включает интерактивный выбор остальных
параметров и подтверждение до мутаций; в non-TTY это стабильная ошибка
`INIT_SELECTION_REQUIRED`.

Команды `assign`, `status`, `record`, `verify` и `graph` появляются только после
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
| `.openspec-orch/changes/<base64url(change-id)>.json` | Cycle Record | tracked в Store |
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
assign <change-id> --repo <code-repository-id>...
status <change-id> [--json]
record assignment <change-id> --repo <id> --commit <40-char-sha1>
  --status <completed|failed|blocked> --source <human|agent|ci> [--note <text>]
verify <change-id>
record verification <change-id> --result <pass|fail>
  --source <human|agent|ci> [--note <text>]
```

`assign` требует минимум один явно указанный connected Code Repository, отсутствие
незавершённой Git operation и чистый Store, кроме нормативного файла заменяемого Cycle
Record. `planning_revision` — текущий Store HEAD. Cycle ID всегда
`cycle-<uuid-v4>`.

Текущий Cycle читается из файла рабочего дерева Store, а не напрямую из Git object
HEAD. Отдельная `git status -- <cycle-record>` проверка определяет, закоммичен ли этот
файл; незакоммиченный Cycle виден в `status`, но блокирует запись результатов и
`verify`.

Result Receipt принимает только полный lowercase SHA-1, существующий в выбранном
Repository. Последний Receipt пары Cycle/Repository заменяется с сохранением истории.
`verify` требует `completed` для каждого Repository и вычисляет стабильный
`snap-v1-<sha256>` из version, Cycle ID и отсортированных Repository/SHA. Он не делает
checkout и не запускает тесты. Verification Receipt относится только к текущему
Snapshot.

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

Base Template поставляет schema `base-v1`, context и project assets, а
`openspec-base` Extension — project commands,
skills, subagent и постоянные инструкции. Эти файлы управляют поведением агента, но не
становятся проверками Core runtime. Change Tracking остаётся необязательным: без него
Apply работает в standard mode; при установленном и связанном Plugin Base skill делает
handoff в plugin-owned Apply context.

Template-правила Planning, Gate, Release и Archive являются политикой создаваемого
проекта. Core их копирует и проверяет структуру, но сам не выполняет реализацию,
проектные тесты, PR, merge, release или Archive.
