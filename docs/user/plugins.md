# Plugins

Plugin расширяет Orchestrator собственными командами, repository lifecycle или
Agent Extension. Template не устанавливает Plugins автоматически, а Core не знает
особенности конкретного Plugin.

Plugin package выполняется как доверенный in-process код. Core проверяет manifest,
package identity и структуру public API, а SDK ограничивает передаваемый context,
файловые пути и параметры процессов, но не является sandbox. Устанавливайте только
проверенные packages из принятого immutable source.

Command contribution становится доступен после `plugin init` и сам по себе не требует
Repository binding. Repository contribution начинает работать после `plugin connect`.
Если этот же Plugin поставляет Agent Extension, она подключается и отключается вместе
с binding конкретного Repository.

## Стандартная поставка

| Plugin | Scope | Назначение |
|---|---|---|
| `openspec-graph` | Store | Проверяет граф Store, Changes, Specs и Repository Impact |
| `change-tracking` | Store и Code Repository | Связывает OpenSpec tasks с revisions Code Repositories |
| `codegraph` | Store или Code Repository | Управляет локальным CodeGraph index и Agent Extension |

Bundled Plugins поставляются вместе с выбранной версией Orchestrator. `plugin init`
проверяет package и добавляет его exact identity в `openspec-orch.yaml`, а
`plugin connect` добавляет binding в запись Repository. Эти изменения относятся к
Store и должны проходить обычные diff, review и commit.

Внешний Plugin материализуется в локальный cache Store, который не попадает в Git.
На новой машине до обычного `connect` установите отсутствующий runtime из принятого
source:

```bash
openspec-orch plugin init \
  --plugin <plugin-id> \
  --from <exact-source>
openspec-orch connect
```

Обычный `connect` восстанавливает lifecycle и Agent Extensions уже объявленных
bindings, но не скачивает отсутствующий внешний package. Если runtime недоступен,
сначала повторите `plugin init` с source, который даёт принятую package identity.

## Общий lifecycle

```bash
cd /absolute/path/to/store
openspec-orch plugin init --plugin <plugin-id>
openspec-orch plugin connect <plugin-id> --repo <repository-id>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec <plugin-id> --repo <repository-id> -- <command>
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

`connect`, `status`, `sync`, `exec` и `disconnect` относятся к repository contribution.
Для commands-only Plugin после `init` используйте его собственную command namespace;
только доверенные bundled Plugins могут получать явно разрешённые root commands.
`sync` и `exec` не универсальны: используйте их лишь там, где Plugin явно объявляет
эти операции.

Без selector `plugin init` показывает каталог в TTY. В non-TTY передайте `--plugin`
или `--all`; вариант с `--from` принимает ровно один `--plugin` и один source.
Обычная command namespace внешнего Plugin вызывается как
`openspec-orch <plugin-id> <command>`.

Для `connect`, `sync`, `exec` и `disconnect` при работе с несколькими repositories
повторите `--repo` или используйте `--all`. Без selector эти команды показывают
выбор в TTY, а в non-TTY требуют явный selector. `status` не поддерживает `--all`:
без `--repo` он показывает все bindings, а `--repo` ограничивает результат.
`disconnect` удаляет binding и отключает Plugin-owned Extension, но не удаляет
данные Plugin из Repository. `remove` разрешён только без bindings.

`init`, `connect`, `disconnect` и `remove` могут менять `openspec-orch.yaml`.
`status` не меняет declaration или bindings и по контракту диагностирует состояние.
`sync` и `exec` также не меняют declaration или bindings, но могут менять принадлежащее
Plugin состояние согласно его собственному контракту.

## Проверяемое отключение и удаление

Сначала зафиксируйте текущее состояние, затем удалите все bindings и только после этого
declaration Plugin:

```bash
openspec-orch plugin status --plugin <plugin-id> --json
openspec-orch plugin disconnect <plugin-id> --all
openspec-orch plugin status --plugin <plugin-id> --json
git diff -- openspec-orch.yaml
openspec-orch plugin remove <plugin-id>
openspec-orch doctor
git diff -- openspec-orch.yaml
```

Если Plugin поставляет Agent Extension, дополнительно проверьте native состояние:

```bash
# Qwen и GigaCode: Extension должна быть disabled или отсутствовать
qwen extensions list

# Claude: Plugin не должен оставаться активным в текущем project scope
claude plugin list --json
```

`disconnect` сначала отключает Plugin-owned Extension и затем удаляет portable binding.
Для Qwen/GigaCode payload может остаться установленным, но disabled; Claude adapter
удаляет local Plugin и marketplace текущего scope. `remove` удаляет declaration и
Store-local runtime внешнего Plugin. Ни одна из этих команд не удаляет tracked
repository data, локальный Plugin storage или созданные Plugin данные вроде
`.codegraph/`: их миграция и очистка относятся к контракту конкретного Plugin.

Если отключение завершилось частично, не запускайте `remove`. Сохраните
`doctor --json`, проверьте оставшиеся bindings через `plugin status`, повторите
`disconnect` адресно с `--repo`, затем снова проверьте native состояние. Обычный
`connect` восстанавливает Extensions только для bindings, которые остались в Store.

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
openspec-orch agent setup --agent qwen
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend

# ручной fallback из чистого Code Repository перед работой над task:
openspec-orch attempt start <change-id> <task-id>
# после commit и стандартной галочки Apply:
openspec-orch attempt complete <change-id> <task-id>
```

Binding к Store нужен Store-scoped CLI-командам `attempt`. Bindings к Code Repositories
нужны там, где будет выполняться Apply; Agent Extension устанавливается только в них.
Governed MCP сам получает Store context, поэтому отдельный путь к Store в Agent-сессию
передавать не нужно. После установки или подключения перезапустите Agent.

Обычный Agent-flow:

1. Разработчик из Code Repository просит реализовать Change штатным OpenSpec Apply.
2. Extension получает Apply-контекст активной schema и определяет текущий Repository.
3. Перед выбранным каноническим task она вызывает `start_attempt`.
4. После implementation commit, repository checks и стандартной галочки task вызывает
   `complete_attempt`.
5. В Change появляется связь task с planning, base и implementation revisions.

Для Superspec Apply-контекст ведёт к repository section в `plan.md`; другая schema
может вернуть другой artifact. Tracker не разбирает имена файлов и Markdown-заголовки,
поэтому кастомная schema работает через тот же OpenSpec Apply API. Отдельных
`implement-design` и `implement-plan` workflows нет. CLI-команды выше нужны только как
ручной fallback.

В первой Claude-сессии подтвердите доступ только к запрошенным
`openspec-orchestrator` MCP tools. Дополнительный `--add-dir` для Store не требуется.

Change Tracking требует OpenSpec `>=1.11.0 <2`. `attempt start` запускается из чистого
Code Repository для незавершённого task и сохраняет base revision только в локальном
Plugin storage. Незавершённая attempt не переносится на другую машину.

Команда `attempt complete` повторно читает task через
`openspec instructions apply --json`, требует чистый Code Repository, новый commit
после старта и уже установленную стандартную галочку task, а затем добавляет итоговую
revision в `openspec/changes/<change-id>/implementation-map.yaml`. Она не создаёт
commit и не выполняет `pull` или `push`; файл публикуется обычным Git-процессом Change.
Если task возвращён в работу, его галочка снимается и обычный Apply запускается снова.
Tracker создаёт новую attempt от текущей base revision и добавляет её в историю, не
перезаписывая предыдущую implementation revision.

Plugin не назначает Tasks, не меняет их галочки, не выполняет тесты и не участвует
в Verify, Release или Git-публикации. Сохранённая revision помогает найти реализацию
возвращённого task, но сама по себе не доказывает корректность или приёмку фичи.

## CodeGraph

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin status --plugin codegraph --repo frontend
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin exec codegraph --repo frontend -- explore "authentication flow"
```

Каждый binding обслуживает только свой checkout и локальный `.codegraph/`. Индекс
не коммитится: при подключении Plugin добавляет `.codegraph/` в локальный
`.git/info/exclude`, не меняя tracked `.gitignore`. Состояние `stale` или `unavailable`
не запускает `sync` автоматически. CodeGraph помогает исследовать текущий код, но не
создаёт Requirements и не расширяет scope Change. Подробности:
[CodeGraph Plugin](../../plugins/codegraph/README.md).

## Orchestrator MCP

Agent gateway устанавливается отдельно от Project и Plugins:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

MCP предоставляет read tools для status, setup context, Change context, next action,
assignment scope, doctor и Graph, controlled setup tools `initialize_project` и
`connect_project`, а также `start_attempt` и `complete_attempt` для task evidence.
Намеренно отсутствуют verification, Release, Archive, arbitrary Git writes, Plugin
lifecycle, Agent management и network transport.

Для первого запуска через MCP откройте Agent из корня заранее подготовленного Store,
а не из checkout Orchestrator или Code Repository. Проверьте фиксированный `cwd`
через `get_setup_context`, затем вызовите `initialize_project`. Полный payload,
ограничения strict mode и следующий `connect_project` приведены в разделе
[«Альтернатива: инициализация через MCP»](getting-started.md#альтернатива-инициализация-через-mcp).

## Внешний Plugin

`--from` принимает локальный package directory, tarball, Git URL или npm install
spec. Production dependencies устанавливаются без lifecycle scripts, а exact package
identity сохраняется в Store. Сам source должен оставаться доступным команде для
установки runtime на новой машине; локальный cache и credentials в Store не
публикуются.

```bash
openspec-orch plugin init \
  --plugin dependency-audit \
  --from @company/openspec-plugin-dependency-audit@1.2.0
```

Каркас создаётся через `plugin register`:

```bash
# commands-only, binding не нужен
openspec-orch plugin register dependency-audit \
  --profile commands

# repository lifecycle для Code Repositories
openspec-orch plugin register dependency-audit \
  --profile repository \
  --support code \
  --extension
```

Profiles `repository` и `native` создают заготовки lifecycle callbacks, которые нужно
реализовать до `plugin init`; `native` дополнительно поддерживает package-owned argv
runtime. Авторский contract и contract test описаны в
[Plugin SDK](../../packages/plugin-sdk/README.md).
