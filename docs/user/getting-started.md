# Начало работы

## Требования

- Node.js `20.19.0` или новее;
- npm и Git;
- доступный в `PATH` OpenSpec CLI;
- Git remote для Store и каждого Code Repository.

Core проверяет, что `openspec --version` возвращает semantic version. Minimum и exact
pin не заданы, поэтому совместимость конкретной версии подтверждается отдельно в
вашем окружении.

## Создание нового проекта

Target должен заранее существовать, быть обычным каталогом и корнем чистого Git
Repository с настроенным `origin` и выбранной веткой. `init` не создает каталог и не
инициализирует Git. Для локального подключения уже инициализированного Store
используйте `connect`. Повторный `init` для него не создаёт проект заново и нужен
только для явного изменения desired-набора standalone Extensions.

У `init` два режима. В интерактивном терминале можно запустить команду без
обязательных флагов:

```bash
cd /absolute/path/to/workspace/specs
openspec-orch init
```

Команда предложит выбрать Store ID, Template, Agent, Extensions, Code Repositories
и strict/relaxed mode, затем покажет сводку и запросит подтверждение. Рядом с каждым
bundled Template показан его Extension-профиль: `base → openspec-base`,
`superspec → superpowers`. Отмена происходит до записи файлов. Если переданы
`--store` и `--agent`, prompts не открываются и команда работает только через флаги.
В non-TTY эти два флага обязательны.

Пример Store `specs` с двумя Code Repositories:

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main

cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch doctor
openspec-orch repository status
```

`init` создает Store, вызывает штатный OpenSpec init с adapter выбранного агента,
применяет Base или явно переданный Project Template, записывает
`openspec-orch.yaml`. Команда не устанавливает Plugins и не клонирует Code
Repositories: последнее делает последующий `connect` в strict mode.
Повторяемый `--extension <id>` выбирает standalone Extensions из локальной поставки;
required Extension выбранного Template добавляется автоматически. `--no-extensions`
явно задаёт пустой набор только для Template без requirements и отклоняется для обоих
bundled Template. `init` только сохраняет выбор и не вызывает Agent CLI — нативная
регистрация выполняется последующим `connect`.
Для уже созданного Store повторный `init` без этих флагов сохраняет текущий набор,
а явные `--extension` или `--no-extensions` обновляют только desired composition в
`openspec-orch.yaml`, не применяя Template повторно.

Default Base автоматически включает `openspec-base`. Для полного Superspec workflow
выберите другой Template; его обязательный Extension `superpowers` init также добавит
автоматически:

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --template superspec \
  --repo frontend=ssh://git.example.org/product/frontend.git#main
```

Интерактивный порядок: Store ID, Project Template, Agent, Extensions, Code
Repositories, strict mode, итоговое подтверждение. После выбора Template его required
Extension показан выбранным и заблокированным; `--no-extensions` несовместим с
`base` и `superspec`.

Superspec хранит brainstorming, plan, Apply/Verify/Finalize receipts внутри текущего
OpenSpec Change. Finalize использует structured branch closeout Superpowers отдельно
для каждого Code Repository, но внешние мутации требуют явной авторизации. Deployment,
Release и Archive остаются отдельными командными gates.

После `connect` запускайте глобальный CLI выбранного Agent напрямую из Store:

```bash
qwen
# либо
claude
```

Agent самостоятельно загружает активированные instructions, skills, commands, hooks
и MCP. Orchestrator не оборачивает Agent CLI; `plugin exec` используется только для
runtime Plugins.

При `--no-strict` проект получает `strict: false`. Тогда `connect` не клонирует и не
проверяет Git identity/remote/branch/clean state; каталоги
`<workspace>/src/<repository-id>` должны существовать заранее.

## Что появляется в Store

```text
openspec-orch.yaml
.openspec-store/store.yaml
openspec/
├── config.yaml
├── schemas/base-v1/
├── context/
├── specs/
└── changes/
```

Base Template применяется только во время `init` и не создаёт provider-specific
instructions, commands или skills. Выбранный `openspec-base` подключает их нативно при
`connect`. Template-файлы становятся частью Store и автоматически не обновляются.
`superpowers` подключает локально поставляемую библиотеку skills; сеть и GitHub для её
регистрации не нужны. Для `superspec` этот Extension является required composition.

## Подключение workspace

Обычная раскладка определяется по родителю Store. Для нестандартного расположения
задайте workspace явно:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

В strict mode путь запоминается локально в `.openspec-orch/state.json`. При переносе
workspace повторите команду с новым абсолютным путем. `connect` проверяет Store,
регистрирует его в OpenSpec, создает или проверяет Code Repository checkout и
OpenSpec pointer. Если Code Repositories не выбраны, этот цикл пуст. До мутаций
Extension выполняется preflight Agent CLI, после подключения — итоговый status
standalone и Plugin-contributed Extensions. Существующий checkout не получает
`pull`, `checkout` или `reset`.

## Первичное подключение OpenSpec Graph

OpenSpec Graph — отдельный Plugin и не устанавливается Template или Extension
автоматически. Полный описанный `openspec-base` flow использует его после появления
Delta Specs и перед Apply, поэтому для этого маршрута сначала установите Plugin, а
затем явно создайте binding:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch graph inspect --json
```

`plugin connect` проверяет Extension contribution, выполняет repository lifecycle,
нативно активирует Store-scoped Agent Extension и только после общего успеха сохраняет
binding. `graph inspect` компилирует текущий Store непосредственно из файлов.
Intake-only или Proposal-only Change может дать warning об отсутствующих Delta Specs.

## Минимальная проверка готовности

```bash
openspec-orch doctor
openspec-orch repository status
openspec-orch plugin status --plugin openspec-graph
openspec-orch graph inspect --json
```

`doctor` ничего не исправляет: он проверяет Store, OpenSpec, локальные repositories,
standalone Extensions и Plugin bindings. `doctor --json` выводит тот же Diagnostic
Report для CI; при блокирующей ошибке команда завершится с кодом `1`. Для Graph
ожидаемый результат — `errors: 0`. Каждый warning нужно разобрать до продолжения workflow.

## Следующий шаг

- для личной работы — [поток одного человека](solo-flow.md);
- для распределения ответственности — [командный поток](team-flow.md);
- для существующего или нестандартного проекта — [конфигурация](configuration.md).
