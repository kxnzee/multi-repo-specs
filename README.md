# OpenSpec Orchestrator

OpenSpec Orchestrator — локальный CLI для подготовки OpenSpec Store, подключения
нескольких Code Repositories и установки проектного процесса и Plugins без переноса
их логики в Core.

## Архитектура

| Слой | Ответственность |
|---|---|
| OpenSpec | Changes, Specs, schema, Planning artifacts, Apply и Archive |
| Orchestrator Core | `init`, `connect`, repository routing, Git/OpenSpec checks и Plugin lifecycle |
| Project Template | Context, custom schema/config и дополнительные assets |
| Agent definition | OpenSpec adapter и нативный способ подключения Extension |
| Extension | Instructions, skills, commands, subagents, hooks и простые MCP |
| Plugin | Собственные команды, runtime/repository lifecycle и target-scoped Extension |

Core не планирует Change, не интерпретирует требования и не запускает Jira, Zephyr,
CI, deployment или ручное тестирование. Он также не выполняет `git add`, `commit`,
`push`, `merge` или `rebase`. Эти действия остаются в действующем процессе команды.

## Project Templates и Extensions

Без `--template` команда `openspec-orch init` использует
[`templates/base/`](templates/base/). Этот Template устанавливает только:

- project-local schema `base-v1`:
  `intake → proposal → specs → design → tasks`;
- `openspec/config.yaml` и project context в `openspec/context/`;
- дополнительные assets, включая `.gitignore`.

Bundled [`templates/superspec/`](templates/superspec/) — альтернативный, а не
дополнительный Template. Он устанавливает schema `superspec-multirepo` с pipeline
`brainstorm → proposal → optional design → specs → tasks → plan → apply → verify →
finalize`, Apply/Verify convergence и multi-repository gates. Template декларативно
требует независимый Extension `superpowers`, поэтому init добавляет его автоматически:

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --template superspec
```

В интерактивном init Project Template выбирается перед Agent и Extensions. После
`superspec` Extension `superpowers` показан выбранным и недоступным для снятия;
`--no-extensions` для этой композиции отклоняется.

Agent, optional Extensions и Plugins выбираются отдельно. Bundled Extension `openspec-base`
поставляет workflow-инструкции, `/openspec-base-*`, project skills и repository
evidence subagent. Bundled `superpowers` поставляет локальный MIT-снимок общей
библиотеки skills. Оба поддерживают Claude, Qwen и GigaCode и не зависят от Template.
OpenSpec Graph, CodeGraph и Change Tracking остаются отдельными Plugins и доставляют
свою Agent-часть как target-scoped Extension.

`openspec-base-test-cases` может сформировать тест-кейсы из принятых Requirements и
Scenarios, в том числе нейтральную структуру для последующего переноса в Zephyr. Он
ничего не загружает и не считает проверку выполненной без внешнего evidence.

Каждый `tasks.md` завершается общим checkpoint:

```markdown
## N. Проверка реализованного изменения — Ответственный: <участник>

- [ ] N.1 Получить подтверждение, что текущая версия изменения успешно проверена в целевом окружении по принятым сценариям, а все блокирующие дефекты устранены и повторно проверены.
```

Агент не закрывает этот пункт самостоятельно. Новая версия или deployment после
подтверждения снова делают его незавершённым. Archive дополнительно требует
фактический Release. Base schema хранит checkpoint только в Tasks; Superspec также
создаёт технический `verify.md`, который не заменяет внешнее подтверждение.

Template применяется только во время `init`. Bundled IDs `base` и `superspec`
разрешаются из каталога поставки; локальный путь указывают явно, например
`--template ./team-template`. Скопированные файлы принадлежат Store и не обновляются
автоматически. Custom Project Template полностью заменяет Base Template, но не меняет
отдельно выбранные Agent, Extensions или Plugins.

## Требования и локальная установка

- Node.js `20.19.0+`;
- npm;
- Git;
- OpenSpec CLI, чей `--version` возвращает semantic version; minimum и exact pin Core
  не задаёт.

Из корня репозитория:

```bash
npm install
npm run check
npm link
openspec-orch --help
```

После смены активной версии Node.js через NVM выполните `npm link` повторно. Без
регистрации в `PATH` CLI можно вызвать так:

```bash
node /absolute/path/to/multi-repo-specs/bin/openspec-orch.js --help
```

## Инициализация проекта

Пример создания Store с двумя Code Repositories:

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --extension openspec-base \
  --extension superpowers \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main

cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch repository status
```

Template не выбирает Plugins. Если нужен OpenSpec Graph, Plugin и его Store binding
добавляются явно:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch graph inspect --json
```

`graph inspect` каждый раз компилирует текущий Store непосредственно из его файлов.

Выбор `--extension` во время `init` задаёт только desired composition: Core разрешает
ID и bundled source из каталога поставки и записывает их в `openspec-orch.yaml`, не
вызывая native CLI Agent. Во время последующего `connect` Orchestrator разрешает
локальный payload, проверяет manifests всех поддерживаемых Agents и только затем
передаёт `connect` адаптеру выбранного Agent. Поэтому одна portable-конфигурация
восстанавливает те же Extensions на каждой рабочей машине.

Для нестандартной раскладки workspace задаётся один раз:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

Локальный путь сохраняется в `.openspec-orch/state.json`. `connect` может клонировать
отсутствующие Code Repositories в strict mode, но не обновляет существующие checkout.
Ноль Code Repositories допустимы. Перед native mutation выполняется Agent preflight,
затем восстанавливаются standalone Extensions, Plugin runtime/contributions и их
итоговый status. `repository status` ничего не исправляет и не выполняет сетевых
операций.

## Пользовательский путь Change

```text
согласованный Intent
→ Intake
→ при необходимости Explore
→ Proposal → Specs → Design → Tasks
→ Gate 1
→ Apply
→ PR → Review → Merge → Deploy
→ проверка текущей версии и закрытие финального checkpoint в tasks.md
→ Release
→ Archive
→ необязательный context/ADR audit
```

### 1. Intent и Intake

Если Jira Story или другой принятый источник уже содержит изменение, Why Now,
ожидаемый результат, критерии успеха и ограничения, повторно проходить `base-intent`
не нужно. Иначе сначала сформируйте с ним Daily Intent Brief.

Из корня Store запустите в агенте:

```text
/openspec-base-intake <change-id>
```

Команда задаёт по одному недостающему вопросу и сама создаёт или продолжает
`intake.md`. Результат Intake содержит один маршрут:

- `ready_for_proposal` — продолжить штатное OpenSpec Planning;
- `explore_recommended` — выполнить `/opsx-explore`, затем повторить Intake для
  сохранения findings и нового решения;
- `blocked` — получить недостающее решение или нормативный источник.

### 2. Planning и Apply

Proposal, Delta Specs, Design и Tasks создаются штатным OpenSpec workflow. Перед
встроенным Apply `openspec-base-apply-context` проверяет Graph и Repository Impact,
затем передаёт управление OpenSpec Apply.

Без Change Tracking используется Standard Apply. Его отсутствие не является ошибкой
и не приводит к автоматической установке Plugin.

### 3. Проверка, Release и Archive

PR, deployment, Jira/Zephyr, QA и работа с дефектами выполняются внешним процессом
команды. После проверки текущей версии ответственный участник явно подтверждает
финальный checkpoint в `tasks.md`. Пока он открыт, блокирующие дефекты не устранены
или была развёрнута новая непроверенная версия, Archive запрещён.

После фактического Release выполняется штатный `/opsx-archive`. Затем можно запустить
необязательный read-only audit долговечного контекста:

```text
/openspec-base-context audit --change <change-id>
/openspec-base-context audit --spec <capability-path>
/openspec-base-context audit --domain <domain-path>
```

Запись context или ADR выполняется только режимом `update`, после показа конкретного
diff и отдельного подтверждения пользователя.

## Plugins

Стандартная поставка содержит три независимых Plugin:

| Plugin | Назначение | Scope |
|---|---|---|
| `openspec-graph` | Store-level связи Repository, Master Spec, Change и Delta Spec | Store |
| `codegraph` | Локальная навигация по файлам и symbols одного выбранного checkout | Store или Code Repository |
| `change-tracking` | Cycle, Result Receipts, Snapshot и Verification Receipt | Store и выбранные Code Repositories |

OpenSpec Graph, CodeGraph и Change Tracking подключаются по решению команды. Template
и Core продолжают работать без них в доступном Standard flow.

При этом полный workflow bundled Extension `openspec-base` использует OpenSpec Graph
после появления Delta Specs и перед Apply. Plugin остаётся отдельным выбором и не
устанавливается автоматически: для этого маршрута его нужно явно инициализировать и
связать со Store.

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend --repo backend
openspec-orch plugin status --plugin codegraph
openspec-orch plugin sync codegraph --all
```

Простые MCP объявляются в native manifests соответствующего Extension. Plugin со
сложным repository lifecycle может поставлять свой target-scoped Extension; его Agent
payload активируется нативным CLI во время `plugin connect`.

Change Tracking является необязательным расширением Apply. После его установки и
подключения Base skill передаёт plugin-owned `change-tracking-apply-context` проверки
Cycle, а затем продолжает общий Graph preflight. Команды расширения:

```bash
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

```text
openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id> [--json]
openspec-orch record assignment <change-id> --repo <repository-id> --commit <sha> --status <completed|failed|blocked> --source <human|agent|ci>
openspec-orch verify <change-id>
openspec-orch record verification <change-id> --result <pass|fail> --source <human|agent|ci>
```

`verify` вычисляет точный Snapshot, но не запускает тесты. Результат внешней проверки
записывается отдельно и не заменяет человеческое подтверждение финального checkpoint
в `tasks.md`.

Подробнее: [Plugins](docs/user/plugins.md),
[OpenSpec Graph](plugins/openspec-graph/README.md) и
[Project Template](docs/user/project-template.md).

## Публичный Core CLI

```text
openspec-orch init [path] --store <id> --agent <id> [--template <id-or-path>] [--extension <id>]... [--no-extensions] [--repo <id=remote#branch>]... [--no-strict]
openspec-orch connect [--workspace <path>] [--no-strict]
openspec-orch disconnect
openspec-orch repository status [--repo <repository-id>]...

openspec-orch plugin register <plugin-id> [path] [--name <display-name>] [--profile <commands|repository|native>] [--support <store|code>]... [--extension]
openspec-orch plugin init [--plugin <plugin-id>] [--from <source>] [--all]
openspec-orch plugin connect <plugin-id> [--repo <repository-id>]... [--all]
openspec-orch plugin status [--plugin <plugin-id>] [--repo <repository-id>] [--json]
openspec-orch plugin sync <plugin-id> [--repo <repository-id>]... [--all]
openspec-orch plugin exec <plugin-id> [--repo <repository-id>]... [--all] -- <command> [args...]
openspec-orch plugin disconnect <plugin-id> [--repo <repository-id>]... [--all]
openspec-orch plugin remove <plugin-id>
```

После `connect` пользователь запускает глобальный CLI выбранного Agent напрямую из
Store (`qwen` или `claude`). Orchestrator не проксирует Agent commands; универсальный
`exec` остаётся только у Plugins и вызывает их собственный runtime.

`init` поддерживает два режима: с обязательными `--store`/`--agent` он не открывает
prompts, а в TTY без одного из них запускает интерактивный выбор Template, Agent,
Extensions, Code Repositories и strict/relaxed mode с подтверждением до записи.
В non-TTY `--store` и `--agent` обязательны.

Plugin может добавить собственный namespace, например `openspec-orch graph ...` или
`openspec-orch <plugin-id> <command>`. Фактическую grammar показывает `--help` после
установки Plugin.

Progress пишется в `stderr`, поэтому не загрязняет JSON и raw stdout. Exit codes:
`0` — успех или отказ от подтверждаемой записи, `1` — ошибка выполнения/проверки,
`2` — неверный вызов CLI.

## Конфигурация

Минимальный `openspec-orch.yaml` после `init`:

```yaml
version: 2
strict: true
template:
  id: base
agent:
  id: qwen
extensions:
  - id: openspec-base
    source: bundled:openspec-base
  - id: superpowers
    source: bundled:superpowers
plugins: []

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: []
  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
    plugins: []
```

Binding Plugin записывается в `repositories[].plugins`. Точный контракт и strict/
relaxed behavior описаны в [справочнике конфигурации](docs/user/configuration.md).

## Локальные и версионируемые данные

| Данные | Расположение | Git |
|---|---|---|
| Project config | `openspec-orch.yaml` | да |
| Specs, Changes, Template assets и upstream OpenSpec pack | `openspec/`, provider directories | да |
| Native registration Extensions | локальный project/local scope выбранного Agent | нет |
| Cycle Records Change Tracking | `.openspec-orch/changes/*.json` | да |
| Локальный workspace Core | `.openspec-orch/state.json` | нет |
| Plugin state | `.openspec-orch/plugins/<plugin-id>/state.json` | нет |
| Runtime внешних Plugins | `.openspec-orch/cache/plugin-runtimes/<plugin-id>/` | нет |

Локальное состояние валидируется при чтении и записывается атомарно. Повреждённое
состояние не исправляется и не перезаписывается автоматически.

## Документация и разработка

- [вся актуальная документация](docs/README.md);
- [пользовательская документация](docs/user/README.md);
- [командный процесс](docs/user/team-flow.md);
- [техническая документация](docs/technical/README.md).

Проверки разделены по владельцам:

```bash
npm run lint
npm run test:code
npm run check:template
npm run check:agent-artifacts
npm run check
```

`test:code` проверяет Core, SDK, Plugins и integration-код. Template и agent artifacts
проверяются отдельными suites и не связывают расширяемый Template с Core tests.
