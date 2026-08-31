# Plugins

Plugin расширяет Orchestrator собственными командами, repository lifecycle или
Agent Extension. Template не устанавливает Plugins автоматически.

## Стандартная поставка

| Plugin | Scope | Назначение |
|---|---|---|
| `openspec-graph` | Store | Проверяет граф Store, Changes, Specs и Repository Impact |
| `change-tracking` | Store и Code Repository | Фиксирует revisions и внешнюю проверку точного candidate |
| `codegraph` | Store или Code Repository | Управляет локальным CodeGraph index и Agent Extension |

## Общий lifecycle

```bash
openspec-orch plugin init --plugin <plugin-id>
openspec-orch plugin connect <plugin-id> --repo <repository-id>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec <plugin-id> --repo <repository-id> -- <command>
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

`sync` и `exec` не универсальны: используйте их только для Plugins, в разделе
которых эти операции явно указаны.

Для нескольких repositories повторите `--repo` или используйте `--all`. Без
selector TTY показывает выбор, а non-TTY требует явный selector. `disconnect`
удаляет binding и отключает Plugin-owned Extension, но не удаляет данные Plugin из
Repository. `remove` разрешён только без bindings.

## OpenSpec Graph

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch graph inspect --json
openspec-orch graph view --port 0
```

Каждый вызов компилирует текущие файлы Store. Graph использует Master/Delta Specs и
строгую таблицу `Repository | Capabilities` из Proposal. Он не читает Code
Repositories и не доказывает ownership, реализацию или runtime dependency.

Полный contract: [OpenSpec Graph Plugin](../../plugins/openspec-graph/README.md).

## Change Tracking

```bash
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend

openspec-orch track <change-id>
# из каждого затронутого чистого Code Repository:
openspec-orch done
# после внешней проверки собранной версии:
openspec-orch verify pass
openspec-orch status [change-id]
```

`track` берёт scope из принятого Repository Impact. `done` передаёт текущий
implementation commit, а `verify pass|fail` только записывает результат уже
выполненной проверки. Plugin не выполняет Tasks, тесты, deployment или Release.

Изменяющие команды синхронизируют Git Store, создают tracking commit и по умолчанию
публикуют его. `--no-push` оставляет commit локально. Новый `done` меняет
candidate и делает прежнюю verification неактуальной.

`status` читает только текущую локальную копию Store и не выполняет `git pull`.
Обновляйте Store обычным командным Git-процессом перед чтением удалённых изменений.

## CodeGraph

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin status --plugin codegraph --repo frontend
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin exec codegraph --repo frontend -- explore "authentication flow"
```

Каждый binding обслуживает только свой checkout и локальный `.codegraph/`. Индекс
не коммитится. CodeGraph помогает исследовать текущий код, но не создаёт Requirements
и не расширяет scope Change. Подробности: [CodeGraph Plugin](../../plugins/codegraph/README.md).

## Orchestrator MCP

Agent gateway устанавливается отдельно от Project и Plugins:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

MCP предоставляет read tools для status, setup context, Change context, next action,
assignment scope, doctor и Graph, а также controlled setup tools
`initialize_project` и `connect_project`. Намеренно отсутствуют receipt,
verification, Release, Archive, arbitrary Git writes, Plugin lifecycle, Agent
management и network transport.

## Внешний Plugin

`--from` принимает локальный package directory, tarball, Git URL или npm install
spec. Production dependencies устанавливаются без lifecycle scripts, а exact package
identity сохраняется в Store.

```bash
openspec-orch plugin init \
  --plugin dependency-audit \
  --from @company/openspec-plugin-dependency-audit@1.2.0
```

Каркас создаётся через `plugin register`. Авторский contract описан в
[Plugin SDK](../../packages/plugin-sdk/README.md).
