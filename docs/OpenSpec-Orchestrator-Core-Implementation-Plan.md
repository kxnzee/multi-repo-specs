# План архитектуры OpenSpec Orchestrator

## 0. Общая модель

- Статус: `in_progress`.
- Стадия продукта: проектирование до первого внешнего использования.
- Рабочая ветка: `refactor-orchestrator-core`.
- Стабильный публичный CLI-контракт ещё не объявлен.

Оркестратор имеет два обязательных слоя и одну опциональную точку расширения:

```text
OpenSpec Orchestrator
|
+-- Orchestrator Core
|   +-- исполняемые команды openspec-orch
|   +-- Store, Git и repository mechanics
|   +-- вызов публичного OpenSpec CLI
|   +-- копирование Project Template
|   +-- техническая безопасность
|
+-- Project Template
|   +-- skeleton и OpenSpec config
|   +-- project-local schemas
|   +-- agent commands, skills и subagents
|   +-- инструкции, роли, gates и процесс команды
|
+-- Orchestrator Plugins (опционально)
    +-- Jira/SberTrack и другие внешние интеграции
    +-- дополнительные технические capabilities Core
```

Базовая работа требует Core и Project Template, скопированного в проект через `openspec-orch init`. Plugins подключаются только при необходимости внешней программной интеграции.

### 0.1. Публичное именование

- Название продукта: **OpenSpec Orchestrator**.
- Рабочее имя npm-пакета: `@<org>/openspec-orchestrator`; конкретный scope определяется перед публикацией.
- Имя исполняемого CLI: `openspec-orch`.
- Core-owned project configuration: `openspec-orch.yaml`.
- Пространство имён `openspec-orch` принадлежит исполняемым командам и техническим файлам Core, а не agent-facing assets Template.
- Имена agent commands, skills и process instructions определяет Template. Рекомендуемый формат — `<template-prefix>-<action>`; базовый SDD Template использует `sdd-*`.
- Официальные `openspec` CLI, `opsx-*` commands и `openspec-*` skills не переименовываются и не подменяются.

`SDD` используется как название методологии Spec-Driven Development и префикс assets базового Template, но не как имя продукта, CLI, конфигурации или внутреннего слоя Core.

### 0.2. Однонаправленная модель расширения

```text
Orchestrator Plugins
    |
    | расширяют публичный Plugin API
    v
Orchestrator Core
    |
    | оркестрирует через публичный CLI
    v
OpenSpec

Project Template
    |
    | проецирует возможности Core в OpenSpec-проект
    v
agent runtime и project-local OpenSpec configuration
```

Правила зависимости:

1. **Core → OpenSpec.** Core вызывает официальный публичный CLI и проверяет его структурированные ответы. OpenSpec ничего не знает об OpenSpec Orchestrator.
2. **Template → Core/OpenSpec.** Template использует публичные команды Core и поддерживаемые файловые и конфигурационные точки OpenSpec. Core знает только минимальный формат Template и не зависит от состава его project files.
3. **Plugin → Core.** Plugin реализует публичный Plugin API. Core знает только capability contract и не зависит от конкретного Plugin.
4. Core и базовый Template не изменяют внутреннюю реализацию OpenSpec. Пользовательский Template технически может переопределить созданные OpenSpec файлы; это явный выбор и ответственность его автора.

Целевая формула:

> Project Template внедряет в OpenSpec-проект дополнительную обвязку OpenSpec Orchestrator. Базовый Template использует поддерживаемые точки расширения OpenSpec; пользовательский Template может намеренно переопределить его файлы. Orchestrator Core при этом не изменяет внутреннюю логику OpenSpec. Orchestrator Plugins добавляют технические capabilities в Core через публичный Plugin API.

### 0.3. Владение процессом

- Core исполняет технические операции и обеспечивает безопасность, но не определяет процесс команды.
- Project Template определяет агента, схему, инструкции, роли, gates и последовательность действий команды.
- Plugin предоставляет возможность, но не решает, когда она обязательна. Это задаёт Project Template.
- OpenSpec управляет Changes, Specs, schemas, artifacts и собственным `opsx-*` workflow.

Например, Jira Plugin может предоставить `ticket.validate`, а Template команды решает: вызывать capability перед Change, оставить её явной командой или не использовать вовсе.

### 0.4. Поставка базового Template

Core и Project Template разделены логически, но базовый Template поставляется обычной директорией внутри дистрибутива OpenSpec Orchestrator: без Template оркестратор не может выполнить `init`. Template не имеет собственного runtime, package lifecycle или управляющих команд.

```text
openspec-orch init [target] --store <store-id> --agent <agent-id> [--repo <id=url#branch>]...
openspec-orch init [target] --store <store-id> --agent <agent-id> --template <local-directory> ...
```

Без `--template` используется внутренний базовый Template. Явный локальный каталог полностью заменяет его; базовый и пользовательский Template не смешиваются. После успешного копирования project files принадлежат проекту. Обновление OpenSpec Orchestrator не запускает `init` повторно и не переписывает их.

OpenSpec обновляется своим штатным способом. В целевой архитектуре документация указывает рекомендуемую проверенную версию, а project-local schema может изменяться независимо от Core. Текущий exact pin OpenSpec сохраняется только как временное ограничение прототипа.

---

# 1. Orchestrator Core

## 1.1. Назначение Core

Orchestrator Core — универсальный CLI-движок `openspec-orch`.

К Core относятся:

- все исполняемые команды `openspec-orch <command>`;
- разбор и проверка CLI-параметров;
- работа с Git, Store и Code Repositories;
- вызов официального OpenSpec CLI;
- безопасное копирование дерева Project Template;
- безопасный handoff к agent-facing assets;
- структурная проверка машинных ответов;
- ограничения путей чтения и записи;
- fail-closed остановка при конфликте или неоднозначности.

## 1.2. Технические инварианты Core

Core во всех режимах обеспечивает:

- однозначную identity OpenSpec root и выбранного Code Repository;
- создание или безопасное продолжение Change через OpenSpec;
- использование схемы, выбранной проектом и разрешённой OpenSpec;
- канонизацию и проверку динамических путей;
- проверку JSON-контрактов OpenSpec;
- запись только в разрешённые roots;
- отсутствие частичного результата при неуспешном обязательном preflight.

В strict mode Core дополнительно обеспечивает:

- безопасное Git-состояние;
- точную Git SHA Store как Spec Baseline;
- immutable runtime Store на этой SHA;
- воспроизводимость runtime по Git revisions.

Template и Plugins не могут скрыто изменить выбранный режим, отключить обязательные security-проверки, расширить allowed write roots или подменить встроенную команду Core.

## 1.3. Граница Core и процесса команды

Core не требует:

- предварительный Explore;
- внешний ticket;
- конкретную OpenSpec-схему;
- фиксированные planning-артефакты;
- Planning PR, Work Packages или Composite Verification;
- конкретные роли, approvals, merge, rollout или Archive flow;
- конкретные локальные проверки реализации.

Core не содержит agent commands, skills, subagents, prompts, project-local schemas и process-specific instructions. Они принадлежат Project Template.

## 1.4. Strict и relaxed mode

Минимальный прототип остаётся полностью Git-based и сохраняет текущий strict-контракт. Relaxed mode ниже является следующим архитектурным этапом и не входит в прототип Template.

Core по умолчанию работает в strict mode. Project configuration может явно выбрать другой default, а CLI-флаг переопределяет его для одного вызова. Рабочее имя флага до утверждения публичного контракта — `--no-strict`.

Приоритет однозначен: явный CLI-флаг → project configuration → Core default `strict`. Core никогда не переходит в relaxed mode автоматически из-за неуспешной strict-проверки.

Strict mode включает:

- обязательную Git identity для Store и Code Repositories;
- проверку origin, default branch, clean worktree и незавершённых Git-операций;
- управляемые planning/implementation branches;
- точную Spec Baseline SHA и immutable Store worktree;
- strict OpenSpec validation;
- воспроизводимый runtime context.

Relaxed mode предназначен для команды, которая хочет использовать обвязку OpenSpec Orchestrator и OpenSpec без явного Git-связывания с оркестратором:

- Git remote, branch automation и clean-worktree policy не обязательны;
- Core не создаёт и не переключает Git branches автоматически;
- OpenSpec работает с явно выбранным текущим root;
- validation выполняется без strict-флага OpenSpec;
- runtime помечается как `unpinned` и не заявляет воспроизводимость по Git SHA;
- функции, которым объективно требуется immutable Baseline, не имитируют гарантию, а возвращают явный ограниченный режим или понятную ошибку.

Relaxed mode не отключает:

- проверку OpenSpec root и Change identity;
- проверку JSON-контрактов;
- канонизацию путей, запрет path traversal и symlink escape;
- allowed read/write roots;
- запрет частичных локальных изменений при неуспешном обязательном preflight.

Точное влияние режима на каждую команду фиксируется в CLI-контракте до реализации. Выбранный режим всегда отражается в stdout/runtime metadata; скрытого перехода из strict в relaxed mode нет.

## 1.5. Контракт взаимодействия с OpenSpec

Core воспринимает OpenSpec как внешнюю систему и использует только её публичные интерфейсы:

- CLI-команды и документированные параметры, включая `cwd`, `--store`, `--schema` и `--json`;
- project-local config и schema-механизм;
- структурированные `root`, `change`, `status`, `instructions` и `contextFiles` из ответа OpenSpec.

Core сам не должен:

- изменять содержимое встроенных `opsx-*` commands и `openspec-*` skills;
- реализовывать собственную версию artifact graph или planning engine;
- создавать planning-артефакты вместо OpenSpec;
- вычислять пути Change и artifacts по известному layout;
- считать `proposal.md`, `tasks.md` или другой файл обязательным для произвольной схемы;
- преобразовывать динамический OpenSpec status в собственную модель артефактов.

Store выбирается штатным `--store` или документированным разрешением root через `cwd`. Все Change и artifact paths берутся из ответа OpenSpec. Core может канонизировать и проверить полученный путь, но не подменяет его собственным ожидаемым путём.

Project Template может добавить config, project-local schema и agent-facing assets. Это настройка через публичные точки расширения, а не изменение внутренней логики OpenSpec.

Пользовательский Template накладывается после официального `openspec init` и технически может заменить созданные им файлы, включая `openspec/config.yaml`, `opsx-*` и `openspec-*`. Core не интерпретирует такое переопределение и не объявляет его совместимым: ответственность несут автор Template и пользователь. Базовый Template не подменяет семантику OpenSpec.

## 1.6. Исполняемые команды Core

### 1.6.1. `openspec-orch init`

Core:

- требует заранее подготовленный чистый Git Store с `origin` и выбранной веткой; текущая ветка становится `default_branch` Store;
- проверяет наличие требуемых публичных OpenSpec capabilities;
- выбирает внутренний базовый либо явно переданный локальный Template;
- до изменений проверяет `template.yaml`, agent mapping, `copy`, типы файлов, пути и конфликты со старыми project files;
- выполняет официальный `openspec init` без `--force`;
- при необходимости переносит созданный agent pack из `generated_directory` в `target_directory`;
- применяет `copy` Template в объявленном порядке поверх результата OpenSpec;
- создаёт и регистрирует Store штатными командами OpenSpec;
- формирует Core-owned `openspec-orch.yaml` и техническую Store metadata;
- проверяет OpenSpec root, config и минимальный набор агента;
- сообщает завершённые, пропущенные и незавершённые операции.

Core не интерпретирует процессный смысл файлов Template и не содержит их обязательного списка. Отсутствие `CODEOWNERS`, Explore, context files, skills, subagents или любой другой необязательной обвязки допустимо.

```bash
openspec-orch init [target] --store <store-id> --agent <agent-id> [--repo <id=url#branch>]... [--template <local-directory>]
```

`target` остаётся позиционным аргументом; отдельного `--target` нет. `--agent` обязателен. `--repo` только на этапе `init` формирует список Code Repositories в `openspec-orch.yaml`; `connect` этот список не изменяет. Без `--template` используется базовый Template, явный локальный каталог полностью его заменяет.

Template имеет приоритет над файлами, созданными текущим `openspec init`, и может переопределить даже OpenSpec config, commands и skills. Он не может записывать в `openspec-orch.yaml`, `.openspec-store/`, `.git/` и за пределы target. Файл, существовавший до запуска, защищён: идентичный по байтам и executable bit пропускается, отличающийся блокирует операцию до применения Template.

Уже инициализированный OpenSpec-проект допустим. Core вызывает штатный `openspec init` без `--force` и не контролирует допустимые изменения, которые сам OpenSpec выполняет в собственных файлах. Конфликт пользовательского Template со старым project file по-прежнему требует ручного разрешения.

После полностью успешного запуска повторный `init` ничего не накладывает и не обновляет. При частичном состоянии команда возвращает `needs_recovery`, не выполняет автоматический rollback и может безопасно продолжить только доказуемые незавершённые операции. Пользователь вправе продолжить изменённым Template; существующие конфликты он разрешает вручную.

Минимальная итоговая проверка агента требует корректные `id`, `openspec_adapter`, безопасные `commands_directory` и `instructions_file`, существующие command directory и instruction file, а также успешный OpenSpec adapter init. Конкретные `openspec-orch-*`, `opsx-*`, skills и subagents проверяются лениво только командой, которая их использует.

`openspec-orch init` не является менеджером жизненного цикла Template: нет версий Template, npm metadata, update, registry, интерполяции, delete rules, произвольных hooks или автоматического merge. Минимальный прототип не меняет текущую exact-version проверку OpenSpec и strict Git-контракт; их ослабление остаётся следующим срезом.

Минимальный Core-owned `openspec-orch.yaml`:

```yaml
version: 1
versions:
  openspec: "1.7.0" # временный exact pin прототипа
agent:
  id: qwen
  openspec_adapter: qwen
  architecture: markdown-commands
  commands_directory: .qwen/commands
  instructions_file: QWEN.md
repositories:
  - id: payments-specs
    role: store
    url: git@example/payments-specs.git
    default_branch: main
```

Agent block обязателен. Для каждого repository обязательны `id`, `role`, `url` и `default_branch`; должна существовать ровно одна запись `role: store`, а Code Repositories могут отсутствовать. После `init` файл принадлежит проекту и может редактироваться вручную. Core не восстанавливает значения, но проверяет структуру, безопасные agent paths и совпадение Store identity с metadata.

### 1.6.2. `openspec-orch connect`

Core:

- подключает участника к существующему Store;
- регистрирует и проверяет Store;
- в strict mode клонирует либо подключает Git checkout;
- в relaxed mode подключает явно переданный локальный repository root;
- создаёт и проверяет штатный config-only Store pointer;
- в strict mode проверяет origin, default branch, Git identity и чистоту;
- в relaxed mode сохраняет только явно выбранную связь root/repository без Git automation;
- сохраняет техническую связь Store и Code Repository.

`connect` читает готовый список repositories из `openspec-orch.yaml` и не редактирует его. Удалённый из config Code Repository перестаёт обрабатываться, но его локальный checkout не удаляется. Отсутствие CODEOWNERS, Explore-инструкции или другого process asset не является повреждением Core.

### 1.6.3. `openspec-orch explore`

Core выполняет только техническую подготовку:

- проверяет Store, workspace и выбранные repositories;
- в strict mode фиксирует точные Git revisions;
- в relaxed mode помечает context sources как `unpinned`;
- лениво проверяет Explore handoff, объявленный выбранным Template;
- передаёт ему проверенные параметры и возвращает handoff.

Что исследовать, какие context-файлы читать и в каком формате возвращать результат, определяет Template. Explore не является prerequisite других Core-команд.

### 1.6.4. `openspec-orch change`

Core:

- проверяет Store и, в strict mode, Git;
- принимает или строит Change ID;
- проверяет технический конфликт;
- создаёт planning branch только в strict mode;
- вызывает `openspec new change`;
- безопасно продолжает существующий Change;
- возвращает исходный динамический `openspec status --json` внутри минимального Core envelope.

Core не передаёт фиксированную схему, не требует Explore или ticket и не знает имён planning-артефактов.

```bash
openspec-orch change --id payment-status
openspec-orch change --ticket PAY-412 --name payment-status
```

Ticket остаётся опциональным параметром. Его внешняя проверка выполняется Plugin только тогда, когда Template объявил её частью процесса.

### 1.6.5. Planning handoff

Planning выполняется внешним `/opsx-continue`, который следует графу выбранной OpenSpec-схемы. Core передаёт точный Store и Change, но не создаёт собственный planning engine и не определяет способ согласования.

### 1.6.6. `openspec-orch load`

Core:

- проверяет Store, Code Repository и Change;
- в strict mode загружает точную Spec Baseline SHA и создаёт immutable Store worktree;
- выполняет OpenSpec validation в выбранном режиме;
- вызывает `openspec instructions apply --json`;
- проверяет OpenSpec root, Change, `contextFiles` и выбранные `tasks[].id`;
- в strict mode создаёт или продолжает implementation branch;
- в relaxed mode использует явно выбранный Code Repository без переключения branch;
- формирует минимальный runtime context;
- передаёт управление Apply-инструкции Template.

Поддерживаются два явных режима:

```bash
openspec-orch load ... --work-package 1 --work-package 2
openspec-orch load ... --whole-change
```

- Package-mode использует только `tasks[].id` из официального Apply JSON.
- Whole-change используется, когда пакетная маршрутизация не нужна или схема не возвращает Tasks.
- Каждый `contextFiles` path проверяется относительно Change root, возвращённого OpenSpec: на точной Baseline в strict mode или из явно выбранного текущего root в relaxed mode.

### 1.6.7. Apply boundary

Отдельной исполняемой команды `openspec-orch apply` сейчас нет. Техническая подготовка заканчивается в `openspec-orch load`, а `sdd-apply.md` и процесс реализации принадлежат Project Template.

Если в будущем появится исполняемая `openspec-orch apply`, команда станет частью Core, но agent-facing инструкция останется в Template.

## 1.7. План реализации Core

Core не реализуется отдельно от Template: граница извлекается вертикальными срезами, чтобы после каждого commit сохранялся рабочий `init` и проверяемый CLI. Полная последовательность изменений, затрагиваемые текущие связки и критерии каждого этапа зафиксированы в разделах 4.2–4.10.

Минимальный прототип заканчивается после перевода `init` на общий Template engine. Schema-neutral команды, совместимость OpenSpec и relaxed mode выполняются следующими этапами и не блокируют проверку самой Template-модели.

## 1.8. Проверки Core

| Сценарий | Ожидаемый результат |
|---|---|
| Локальный Template отсутствует, descriptor некорректен или выбранный agent mapping не существует | Команда останавливается до `openspec init` |
| Template содержит symlink, специальный файл, path traversal или пересекается с target | Init останавливается до записи файлов |
| Из Template удалён `CODEOWNERS`, Explore или целая необязательная директория | Init не ожидает и не создаёт их |
| В Template добавлен новый обычный файл или каталог | Он копируется без изменения Core |
| Template пытается писать в `openspec-orch.yaml`, `.openspec-store/` или `.git/` | Init отклоняет защищённый target |
| Template заменяет файл, созданный текущим `openspec init` | Последняя `copy` Template побеждает |
| Template конфликтует со старым пользовательским файлом | Init останавливается без overwrite; конфликт разрешается вручную |
| Init прерван после внешней операции | Возвращается `needs_recovery` без автоматического rollback |
| В Template добавлен новый безопасный agent mapping | `--agent` принимает его без изменения списка в Core |
| `openspec-orch.yaml` содержит абсолютный или выходящий наружу agent path | Core отклоняет конфигурацию |
| `openspec-orch change` вызван без Explore и ticket | Change создаётся штатным OpenSpec CLI |
| Strict mode включён | Git identity, branches и immutable Baseline обязательны |
| Relaxed mode выбран явно | Git automation пропускается, runtime помечен `unpinned` |
| Relaxed mode получает небезопасный path | Path-проверка всё равно блокирует операцию |
| Кастомная схема использует другие artifacts | Core возвращает исходный OpenSpec status |
| OpenSpec возвращает неожиданный или выходящий наружу path | Core останавливает handoff, не подменяя путь |
| Схема не возвращает Tasks | Whole-change доступен, package-mode отклоняется |
| Runtime Store изменён | Core блокирует продолжение |
| Core проверяется статически | Нет импортов конкретного Template и его agent assets |

---

# 2. Project Template

## 2.1. Назначение Template

Project Template — устанавливаемый набор project-local assets, который проецирует возможности Orchestrator Core в OpenSpec-проект и адаптирует их под конкретную команду.

Template внедряет дополнительную обвязку OpenSpec Orchestrator после штатного `openspec init`. Базовая реализация использует поддерживаемые точки расширения; пользовательская может намеренно переопределить созданные OpenSpec файлы под ответственность команды.

К Template относятся:

- init skeleton;
- `openspec/config.yaml` и project-local schemas;
- agent commands с именами, выбранными автором Template; базовый Template использует префикс `sdd-*`;
- skills, subagents и agent instructions;
- project context;
- роли, gates и процесс команды;
- правила использования доступных Plugins.

Агент и его обвязка OpenSpec Orchestrator определяются Template. Core лишь безопасно устанавливает выбранную конфигурацию.

## 2.2. Рекомендуемый и пользовательский Template

Оркестратор поставляет базовый multi-repo Template как внутреннюю директорию. Команда может использовать его без флага, скопировать как основу или передать собственную локальную директорию через `--template`. Пользовательский вариант полностью заменяет базовый.

Пользовательский Template может:

- заменить OpenSpec-схему;
- изменить context layout;
- добавить или удалить `CODEOWNERS`, Explore и любые другие необязательные файлы или директории;
- заменить или полностью убрать agent commands, skills и subagents, не требуемые выбранным agent mapping;
- определить собственные роли, approvals и delivery flow;
- выбрать обязательные, рекомендуемые или неиспользуемые Plugins.

Список Code Repositories не является содержимым Template: его задают `--repo` при `init`, затем команда может вручную редактировать Core-owned `openspec-orch.yaml`. Изменение исходного Template не требует изменения Core. Обновление OpenSpec Orchestrator не требует повторного `init` и не меняет уже скопированные project files.

Core не отвечает за смысловую целостность процесса внутри Template. Например, текущие `sdd-context.md` и agent instructions ссылаются на `CODEOWNERS`; если команда удаляет `CODEOWNERS`, она должна также изменить или удалить зависимые инструкции. Для Core отсутствие файла допустимо, но Template author отвечает за согласованность оставшейся обвязки.

## 2.3. Минимальный формат Template

Template — обычный каталог без `package.json`, версии и npm lifecycle. Core знает только `template.yaml`; остальные директории автор называет и организует как угодно.

```yaml
agents:
  qwen:
    openspec_adapter: qwen
    generated_directory: .qwen
    target_directory: .qwen
    commands_directory: .qwen/commands
    instructions_file: QWEN.md
    handoffs:
      explore: .sdd/instructions/explore.md
      apply: .qwen/commands/sdd-apply.md
    copy:
      - from: skeleton
        to: .
      - from: commands
        to: .qwen/commands
      - from: providers/qwen
        to: .

  gigacode:
    openspec_adapter: qwen
    generated_directory: .qwen
    target_directory: .gigacode
    commands_directory: .gigacode/commands
    instructions_file: .gigacode/GIGACODE.md
    handoffs:
      explore: .sdd/instructions/explore.md
      apply: .gigacode/commands/sdd-apply.md
    copy:
      - from: skeleton
        to: .
      - from: commands
        to: .gigacode/commands
      - from: providers/gigacode
        to: .
```

Ключ в `agents` является значением обязательного `--agent`. Прототип поддерживает текущую архитектуру `markdown-commands`. `generated_directory -> target_directory` размещает pack официального OpenSpec adapter, после чего `copy` выполняется сверху вниз. При совпадении файлов побеждает последняя запись. Имена `skeleton`, `commands` и `providers` не являются соглашением Core — это лишь пример структуры базового Template.

`handoffs` содержит только пути к Template-инструкциям, которые вызываются конкретными командами Core. Core сохраняет эти пути в `openspec-orch.yaml`, но не задаёт имена файлов и не интерпретирует их содержимое. Agent commands, которые пользователь вызывает напрямую, например `/sdd-context` и `/sdd-change` базового Template, просто копируются и не регистрируются в Core.

Core проверяет только обязательные поля, базовые типы и безопасность путей; дополнительные поля не интерпретирует. Разрешены обычные файлы и каталоги, содержимое копируется без преобразования с сохранением executable bit. Symlink, специальные файловые объекты, выход за target, пересечение Template/target roots и file-directory collisions запрещены. Пустые директории не переносятся.

Локальный Template не проходит npm- или semver-проверку совместимости. Пользователь передаёт его осознанно; `openspec-orch init` проверяет только необходимый Core-контракт и возвращает конкретную ошибку. Для продолжения пользователь исправляет Template и повторяет команду.

У Template нет интерполяции, условий, delete, merge, hooks и per-file `required`/`optional`. Ненужные файлы базового Template удаляются в пользовательской копии; ненужные файлы, созданные OpenSpec, пользователь удаляет вручную после `init`.

Template имеет приоритет над результатом текущего `openspec init`, но не над старыми пользовательскими файлами и защищёнными `openspec-orch.yaml`, `.openspec-store/`, `.git/`. Смысловая согласованность файлов остаётся ответственностью автора Template.

## 2.4. Agent adapters и граница OpenSpec

Template agent adapter настраивает обвязку OpenSpec Orchestrator под файловую модель конкретного агента:

- официальный OpenSpec adapter;
- исходный и итоговый каталоги сгенерированного pack;
- каталог agent commands;
- основной instruction file;
- пути к используемым Core handoffs;
- упорядоченные операции `copy`.

После `init` необходимые runtime-поля сохраняются в `openspec-orch.yaml`; исходный `template.yaml` больше не нужен. Новый provider добавляется изменением Template, если он использует поддерживаемую `markdown-commands` архитектуру. Новый runtime-протокол потребует изменения Core либо Plugin.

`init` проверяет только существование итоговых `commands_directory` и `instructions_file`. Объявленный handoff лениво проверяется только при вызове зависящей от него Core-команды. Фиксированных имён process files в Core нет: базовый Template использует `.sdd/instructions/explore.md` и `sdd-apply.md`, а пользовательский Template может выбрать другие безопасные относительные пути. Отсутствие одного процесса не ломает независимые Core-команды.

Template может использовать собственный префикс для всех agent-facing assets. Если в проекте совмещаются несколько Templates, разные префиксы предотвращают коллизии; Core файлы не переименовывает и соответствие префиксу не валидирует.

Template может переопределить OpenSpec-owned или другие agent files, но Core не импортирует и не запускает Template scripts внутри своего процесса: ими управляет agent runtime. Базовый Template сохраняет OpenSpec-owned semantics; для пользовательского Template совместимость является ответственностью команды.

## 2.5. Схема и процесс команды

Базовый Template поставляет текущую `spec-driven` схему и multi-repo workflow как готовую конфигурацию, а не как правило Core.

Пользовательская схема устанавливается штатно как project-local OpenSpec schema и версионируется вместе со Store. Planning продолжает выполнять `/opsx-continue` по графу этой схемы; Core не добавляет schema adapter.

После копирования схема принадлежит проекту. Команда может изменять или заменять её независимо от Core и исходного Template.

Template может определять:

- Explore и impact discovery;
- создание и согласование planning artifacts;
- Work Package routing;
- Apply-инструкцию и локальные проверки;
- связь PR с Change и Baseline;
- Composite Verification, rollout и Archive guidance.

Template описывает процесс, но не добавляет исполняемые команды `openspec-orch` и не отключает технические инварианты Core.

## 2.6. Использование Plugins из Template

Template может:

- объявить Plugin required, recommended или optional;
- связать стандартную capability с конкретным Plugin;
- передать несекретную конфигурацию и credential reference;
- вызвать явную namespaced action из agent command или skill;
- определить, в какой момент процесса используется Plugin.

Template не скачивает и не устанавливает Plugin автоматически. Отсутствие optional Plugin не ломает независимые команды Core.

## 2.7. План реализации Template

Template не реализуется отдельным потоком работ: он извлекается из текущего `init` одновременно с созданием общего механизма копирования Core. Последовательность, границы commits и критерии приёмки зафиксированы в разделах 4.2–4.5.

Минимальный прототип Template считается готовым, когда один механизм `openspec-orch init` устанавливает и встроенную базовую директорию, и полностью заменяющую её пользовательскую директорию, а изменение состава project files не требует изменения Core.

## 2.8. Проверки Template

| Сценарий | Ожидаемый результат |
|---|---|
| Внутренний базовый Template | Устанавливает готовый multi-repo workflow без `--template` |
| Пользовательский локальный Template | Полностью заменяет базовый и применяет выбранный agent mapping и `copy` |
| Template использует кастомную схему | OpenSpec следует её artifact graph без изменения Core |
| Template не содержит Explore или CODEOWNERS | Независимые команды Core продолжают работать; зависимые process-инструкции исправлены владельцем Template |
| Из Template удалена необязательная директория | Core не восстанавливает её и не считает init повреждённым |
| В Template добавлен новый файл | Файл копируется без новой настройки или изменения Core |
| Template меняет agent adapter Orchestrator | Меняется обвязка OpenSpec Orchestrator, а не семантика OpenSpec |
| Template добавляет agent adapter | Adapter выбирается через `--agent` без изменения Core |
| Source Template недоступен после успешного init | Core использует сохранённый mapping из `openspec-orch.yaml` |
| Локальный Template конфликтует со старым project file | Init останавливается без скрытого overwrite |
| Template переопределяет результат текущего OpenSpec init | Template-файл побеждает |
| Core обновлён отдельно | Уже скопированные project files не изменяются |
| OpenSpec или schema изменены отдельно | Core использует их публичные контракты без повторного копирования Template |
| Adapter переносит совместимый OpenSpec pack | Pack размещается до применения `copy` Template |
| Template меняет `opsx-*` или `openspec-*` | Core разрешает overwrite результата текущего init; ответственность несёт автор Template |
| Skill содержит script | Script не импортируется и не запускается процессом Core |

---

# 3. Orchestrator Plugins

## 3.1. Назначение Plugins

Orchestrator Plugin — доверенный исполняемый модуль, который добавляет Core программную интеграцию с внешней системой или новый технический протокол.

Plugin нужен, когда файлов и agent instructions из Template недостаточно, например для:

- Jira/SberTrack API;
- service catalog;
- Git provider API;
- авторизованной внешней проверки;
- внешней записи с машинным подтверждением результата.

Plugin расширяет возможности Core, но не определяет процесс команды.

## 3.2. Владение Plugins

Команда OpenSpec Orchestrator владеет:

- Plugin API, host и версионированием;
- registry стандартных capabilities;
- SDK, schemas и contract test kit;
- правилами совместимости, установки, разрешений и аудита;
- рекомендуемыми first-party Plugins.

Другие команды могут разрабатывать собственные Plugins. Владелец Plugin отвечает за бизнес-логику интеграции, безопасность, версии, поддержку и идемпотентность внешних writes.

Совместимость с API не означает поддержку Plugin командой OpenSpec Orchestrator.

## 3.3. Capability-модель

Core вызывает Plugins через именованные capabilities, а не произвольные lifecycle hooks.

Есть два типа расширения:

1. **Стандартная capability** — имеет контракт Core и может вызываться в документированном preflight или post-action, например `ticket.validate@1`.
2. **Namespaced action** — принадлежит Plugin, например `company.catalog.lookup@1`, и вызывается только явно через общий Plugin runner.

Новая стандартная capability требует изменения публичного Core-контракта. Новая namespaced action может быть выпущена командой Plugin без изменения Core, но не подключается к lifecycle Core-команд автоматически.

## 3.4. Manifest, установка и конфигурация

Plugin manifest содержит как минимум:

- Plugin ID, версию, publisher и owner;
- совместимую major-версию Core API;
- executable;
- capabilities и их версии;
- read/write mode;
- требуемые network и credential permissions;
- schema несекретной конфигурации.

Plugin распространяется как неизменяемый versioned artifact с checksum. Транспорт не входит в API: допустим внутренний package registry, artifact repository или локальный путь.

Установка, обновление, выдача permissions и удаление выполняются пользователем явно. Template может объявить требование, но не загружает Plugin автоматически.

В проекте фиксируются Plugin ID, точная версия, checksum, capability binding, несекретная конфигурация и `credential_ref`. Binary, локальный путь и секреты в Template, `openspec-orch.yaml` и Store не сохраняются.

Предполагаемый Core CLI:

```text
openspec-orch plugin install <artifact>
openspec-orch plugin list
openspec-orch plugin inspect <plugin-id>
openspec-orch plugin doctor <plugin-id>
openspec-orch plugin run <plugin-id> <namespaced-action>
openspec-orch plugin remove <plugin-id>
```

Названия утверждаются перед реализацией публичного CLI.

## 3.5. Протокол выполнения и trust boundary

Core не импортирует Plugin в свой процесс. Capability вызывается отдельным process invocation через versioned JSON request/response:

```text
Core --JSON request/stdin--> Plugin executable
Core <--JSON response/stdout-- Plugin executable
Core <--diagnostics/stderr---- Plugin executable
```

Core проверяет manifest, версию, capability, timeout, exit code и response schema. Plugin получает минимальный environment, request data и разрешённый credential только на время вызова.

Out-of-process запуск изолирует протокол и сбой Plugin, но не является полноценным OS sandbox. В первой версии устанавливаются только явно одобренные доверенные Plugins. Поддержка недоверенных Plugins потребует отдельного sandbox/container runtime.

Plugin не может через API:

- отключить Core invariants;
- изменить allowed roots;
- зарегистрировать скрытую команду `openspec-orch`;
- изменить Project Template или OpenSpec semantics;
- выполнить не объявленную capability.

## 3.6. Ошибки и внешние writes

- Required read-only gate выполняется до локальных изменений и останавливает операцию fail-closed.
- Optional Plugin при ошибке возвращает `unavailable`, не блокируя независимую Core-операцию.
- Внешняя write capability требует явного действия пользователя.
- Write получает idempotency key и возвращает audit evidence.
- Ошибка внешней записи не запускает скрытый rollback Git или OpenSpec Store.
- Если локальный результат уже создан, Core сохраняет его и возвращает `external_sync_pending` с безопасным retry.

## 3.7. Разработка стороннего Plugin

Команда OpenSpec Orchestrator предоставляет language-neutral protocol specification и первую Node.js SDK:

- request/response types и JSON Schemas;
- manifest validator;
- protocol runner;
- error, timeout, audit и idempotency helpers;
- fake host, fixtures и contract tests;
- операции `validate`, `test` и `pack`.

Путь команды-разработчика:

1. выбрать стандартную capability или создать namespaced action;
2. реализовать manifest и handlers;
3. пройти protocol и contract tests;
4. проверить permissions, redaction и идемпотентность;
5. опубликовать versioned artifact с checksum;
6. явно установить Plugin и выдать permissions;
7. связать Plugin с проектом через Template configuration;
8. проверить конфигурацию через `doctor` без изменения внешней системы.

## 3.8. Первый Plugin после пилота: Jira/SberTrack

Первая итерация — read-only:

- `ticket.resolve@1`;
- `ticket.validate@1`;
- `ticket.find_change_links@1`;
- нормализованный ticket result и решение `allowed/blocked`.

Вторая итерация — explicit writes:

- `ticket.link_change@1`;
- ссылка на Planning или implementation PR;
- согласованное изменение поля или статуса;
- audit evidence и duplicate protection.

Целевой сценарий:

1. Template объявляет ticket validation частью своего процесса.
2. Core вызывает read-only capabilities до создания Change.
3. При `blocked` локальные файлы не создаются.
4. При `allowed` Core штатно создаёт Change через OpenSpec.
5. Jira не изменяется без явного write opt-in.
6. При неуспешном связывании созданный Change сохраняется, а повтор не создаёт дубликат.

## 3.9. План реализации Plugins

Plugins реализуются сразу после пилота Core/Template:

1. зафиксировать manifest, Core API, capability registry и error taxonomy;
2. реализовать host, локальный installed-plugin registry и явную установку;
3. выпустить SDK, fake host и contract test kit;
4. реализовать read-only Jira/SberTrack Plugin;
5. после проверки read-only сценариев добавить explicit writes.

## 3.10. Проверки Plugins

| Сценарий | Ожидаемый результат |
|---|---|
| Plugin не установлен | Core блокирует только зависимую required capability |
| Версия или checksum не совпадают | Plugin не запускается |
| Capability неизвестна | Core отклоняет вызов |
| Несколько providers стандартной capability | Требуется явный binding |
| Timeout или некорректный JSON | Required operation останавливается fail-closed |
| Namespaced action не вызвана | Plugin не перехватывает Core-команды |
| Внешний write не подтверждён | Внешняя система не изменяется |
| Повтор write с тем же idempotency key | Дубликат не создаётся |
| Contract tests пройдены | Подтверждена совместимость API, но не бизнес-логика Plugin |

---

# 4. Порядок реализации

## 4.1. Принцип выполнения

Работа выполняется в ветке `refactor-orchestrator-core`. Исходная ветка остаётся точкой сравнения. Этапы идут последовательно: следующий начинается только после прохождения проверок предыдущего.

Каждый этап должен быть отдельным небольшим commit с наблюдаемым результатом. Простое перемещение файлов без разрыва старой зависимости не считается завершённым этапом. На этапе рефакторинга не меняется смысл текущего базового multi-repo workflow: сначала он переносится в Template, затем Core очищается от знания об этом workflow.

Статус обновляется в этом документе перед commit, завершающим соответствующий этап.

| Этап | Статус | Commit |
|---|---|---|
| 0. Исходное поведение и публичное имя | `completed` | `dea9186`, корректировка границы Template `ec675e5` |
| 1. Базовый Template | `completed` | `refactor: extract base project template` |
| 2. Общий Template engine | `not_started` | — |
| 3. Перевод `init` на Template engine | `not_started` | — |
| 4. Независимость Core-команд от Template | `not_started` | — |
| 5. Schema-neutral OpenSpec-интеграция | `not_started` | — |
| 6. Compatibility и strict/relaxed mode | `not_started` | — |
| 7. Документация и реальный пилот | `not_started` | — |

```text
текущий контракт -> публичное переименование -> базовый Template
-> общий Template engine -> пользовательский Template
-> schema-neutral Core -> compatibility/modes -> пилот -> Plugins
```

## 4.2. Этап 0. Зафиксировать исходное поведение и публичное имя

### 4.2.1. Изменения

1. Добавить characterization-тесты для текущих `init`, `connect`, `explore`, `change` и `load`, прежде чем менять их внутреннее устройство.
2. Зафиксировать текущее дерево файлов, создаваемое `init`, отдельно для Qwen и GigaCode.
3. Атомарно переименовать публичный контракт до начала новых разработок:
   - binary `sdd` → `openspec-orch`;
   - entrypoint `bin/sdd.js` → `bin/openspec-orch.js`;
   - `sdd.yaml` → `openspec-orch.yaml`;
   - Core runtime `.sdd/runtime` → `.openspec-orch/runtime`;
   - пользовательский help, ошибки, документацию и fixtures;
   - Template-owned commands `sdd-*` не переименовывать в namespace Core.
4. Не добавлять compatibility alias и migration layer: внешних пользователей пока нет.
5. До публикации оставить npm scope параметром решения; код и тесты не должны зависеть от конкретного `@<org>`.

### 4.2.2. Проверка этапа

- все исходные сценарии проходят под новым CLI-именем;
- в Core runtime нет старых публичных имён продукта `sdd`; базовый Template сохраняет `sdd-*` как собственный префикс;
- package dry-run содержит новый binary и все прежние runtime-модули;
- поведение команд, кроме именования, не изменилось.

### 4.2.3. Результат

Получена стабильная точка отсчёта с правильным именем продукта. Дальнейший код сразу создаётся под контракт `openspec-orch`, без последующего второго переименования.

## 4.3. Этап 1. Извлечь текущий workflow в базовый Template

### 4.3.1. Изменения

1. Разделить текущие файлы по владельцу:
   - `harness/bin`, `harness/cli`, Git/Store mechanics, OpenSpec runner и security checks оставить в Core;
   - содержимое прежних `harness/init/skeleton`, `commands`, `agents` и `subagents` перенести в `harness/templates/base/`;
   - файлы официального OpenSpec pack не включать в Template: их по-прежнему создаёт `openspec init`;
   - специальный merge-код и проверки состава workflow пометить на удаление на этапе 3.
2. Добавить в базовый Template минимальный `template.yaml` с Qwen/GigaCode agent mappings и упорядоченным `copy`.
3. Исключить из копируемого дерева Core-owned paths: `openspec-orch.yaml`, `.openspec-store/` и `.git/`.
4. Добавить директорию Template в `files` npm-пакета.
5. На этом этапе сохранить итоговое дерево базового `init` эквивалентным characterization fixtures.

### 4.3.2. Проверка этапа

- встроенный Template присутствует в package dry-run;
- Qwen/GigaCode получают те же project files и тот же workflow, что до переноса;
- Core-owned artifacts не лежат внутри Template;
- runtime-модули не импортируют содержимое конкретных command, schema или instruction files.

### 4.3.3. Результат

Текущий процесс физически находится в базовом Template, но пользовательское поведение ещё не меняется.

## 4.4. Этап 2. Реализовать общий Template engine

### 4.4.1. Изменения

1. Добавить разбор локального `template.yaml` без package, registry и version protocol.
2. Получать список допустимых `--agent` из выбранного Template, а не из встроенного реестра Qwen/GigaCode.
3. Построить полный copy plan до первой записи:
   - проверить обязательные поля agent mapping;
   - разрешить `from` только внутри Template root, а `to` — только внутри target;
   - отклонить symlink, специальные файлы, path traversal, пересечение source/target и file-directory collisions;
   - отклонить запись в защищённые Core paths;
   - сохранить порядок `copy` и executable bit.
4. Добавить `--template <local-directory>` в `openspec-orch init`. Без флага автоматически выбирать внутренний базовый Template; указанный каталог полностью его заменяет.
5. Не добавлять интерполяцию, условия, hooks, delete, merge или наследование Templates.

### 4.4.2. Проверка этапа

- один parser и copy planner обслуживают встроенный и пользовательский Template;
- неизвестный agent, некорректный descriptor и небезопасный путь останавливают `init` до внешних вызовов и записи;
- дополнительные обычные файлы и каталоги копируются без регистрации их имён в Core;
- отсутствие необязательных файлов и директорий не считается ошибкой.

### 4.4.3. Результат

Core умеет безопасно прочитать произвольный совместимый Template и заранее вычислить, что именно будет установлено.

## 4.5. Этап 3. Перевести `init` на Template engine

### 4.5.1. Изменения

1. Собрать `init` в один фиксированный технический pipeline:
   `preflight -> openspec init -> перенос generated pack -> copy Template -> Store setup -> openspec-orch.yaml -> post-check`.
2. Разрешить Template переопределять файлы, созданные текущим вызовом `openspec init`, включая agent-specific и OpenSpec config.
3. Защитить файлы, существовавшие до запуска: идентичные пропускать, отличающиеся считать конфликтом без автоматического overwrite.
4. Сохранить выбранный agent mapping и объявленные Core handoffs в `openspec-orch.yaml`; после успешного `init` исходный Template больше не требуется.
5. Удалить из Core:
   - `SHARED_PROJECT_FILES` и специальный merge `CODEOWNERS`/`.gitignore`;
   - принудительный merge `openspec/config.yaml` под `spec-driven`;
   - `REQUIRED_AGENT_COMMANDS`, `REQUIRED_OPEN_SPEC_DIRECTORIES` и обязательный список subagents;
   - сравнение agent config со встроенным Qwen/GigaCode registry.
6. Оставить только минимальный post-check: OpenSpec root, корректный agent mapping, command directory, instruction file и Core-owned config/metadata.
7. Проверять объявленный Template handoff лениво только при вызове зависящей от него Core-команды; не зашивать имя Template-файла в Core.
8. Для partial init возвращать `needs_recovery`, показывать завершённые и незавершённые шаги и продолжать только доказуемо безопасные операции. Не добавлять rollback, Template lifecycle или отдельную transaction subsystem.
9. После полностью успешного `init` повторный запуск должен быть no-op. Пользователь удаляет или меняет скопированные project files вручную.

### 4.5.2. Проверка этапа

- пользовательский Template без `CODEOWNERS`, Explore и одной текущей директории проходит `init`;
- добавленный файл копируется без изменения Core;
- пользовательский `openspec/config.yaml` имеет приоритет над результатом текущего `openspec init`;
- совместимый новый agent mapping принимается без изменения Core;
- попытка записи в `.git/`, `.openspec-store/`, `openspec-orch.yaml` или за target блокируется;
- конфликт со старым пользовательским файлом останавливает применение и требует ручного решения;
- прерванный запуск возвращает понятный `needs_recovery`, успешный повтор не дублирует результат.

### 4.5.3. Результат и граница прототипа

На этом этапе минимальный прототип Template завершён. Он доказывает главное: состав project files, agent mappings и базовый workflow можно менять без правки Core.

В прототип не входят relaxed mode, кастомный artifact graph, Plugin API, Template packages, версии, update/delete и автоматическое сопровождение уже скопированных файлов.

## 4.6. Этап 4. Сделать команды Core независимыми от Template

### 4.6.1. `connect`

- оставить клонирование, проверку Git identity, Store registry и workspace binding;
- убрать обязательные проверки process assets, конкретных commands и subagents;
- валидировать только `openspec-orch.yaml`, Store metadata и данные репозиториев;
- ошибки отсутствующих process files возвращать только из команды, которой они нужны.

### 4.6.2. `explore`

- оставить техническую подготовку workspace/repositories и безопасный agent handoff;
- убрать знание о составе context, `CODEOWNERS`, ролях и содержании Explore-процесса;
- требовать только Explore handoff, объявленный выбранным Template, если пользователь вызвал `explore`.

### 4.6.3. Проверка этапа

- `connect` работает с минимальным Template без Explore, context, `CODEOWNERS` и subagents;
- `explore` сообщает точную lazy-ошибку, если его command отсутствует;
- удаление независимого process asset не ломает `connect` и другие Core-команды.

## 4.7. Этап 5. Сделать OpenSpec-интеграцию schema-neutral

### 4.7.1. `change`

- удалить требования `schema === spec-driven`, `proposal.md`, `design.md`, `tasks.md` и фиксированного artifact graph;
- создавать или продолжать Change через публичный OpenSpec CLI;
- брать schema, root, Change path, status и следующий artifact из структурированного ответа OpenSpec;
- возвращать динамический status без преобразования в собственную модель planning artifacts.

### 4.7.2. `load` и Apply handoff

- получать context files и Tasks из публичного ответа OpenSpec, не вычислять их пути по layout;
- поддержать package-mode только когда OpenSpec возвращает адресуемые Tasks;
- поддержать whole-change mode для схем без Tasks;
- оставить Git Baseline, repository routing и immutable runtime в Core;
- оставить процессные Apply-инструкции в Template и требовать путь из Apply handoff только при его вызове.

### 4.7.3. Проверка этапа

- текущий базовый Template со схемой `spec-driven` продолжает работать;
- тестовый пользовательский Template с другим artifact graph проходит `init -> connect -> change -> load` без изменения Core;
- схема без `proposal.md` и `tasks.md` не отклоняется общими проверками Core;
- все динамические пути канонизируются и проверяются на принадлежность OpenSpec root/Change root.

## 4.8. Этап 6. Ослабить связь с версиями и добавить режимы

### 4.8.1. OpenSpec compatibility

- заменить exact version pin на проверку реально используемых CLI capabilities и JSON fields;
- оставить рекомендуемую проверенную версию OpenSpec только в документации;
- проверить независимые сценарии обновления Core, OpenSpec и project-local schema без повторного `init`.

### 4.8.2. Strict/relaxed mode

- для каждой Core-команды явно зафиксировать различие режимов;
- сохранить strict mode по умолчанию;
- добавить явный `--no-strict` и соответствующее project setting;
- не отключать path, identity и JSON security checks в relaxed mode;
- маркировать неприкреплённый к SHA runtime как `unpinned` и не заявлять для него strict-гарантии.

### 4.8.3. Проверка этапа

- minor-совместимая версия OpenSpec проходит capability checks без изменения Template;
- несовместимый CLI отклоняется по отсутствующей capability с конкретной ошибкой;
- Core обновляется без изменения скопированного Template;
- OpenSpec и project-local schema обновляются без изменения Core;
- strict и relaxed сценарии покрыты отдельными tests и не переключаются скрыто.

## 4.9. Этап 7. Документация и реальный пилот

### 4.9.1. Документация

- обновить README и CLI help под `OpenSpec Orchestrator`/`openspec-orch`;
- описать создание пользовательской копии базового Template и минимальный `template.yaml`;
- явно разделить ответственность Core, Template, OpenSpec и будущих Plugins;
- указать рекомендуемую версию OpenSpec без требования exact pin;
- не изменять `docs/OpenSpec для команды.md`.

### 4.9.2. Пилот

- создать чистый Store и не менее двух независимых Code Repositories;
- пройти `init -> connect -> change -> load -> Apply handoff` без обязательного Explore;
- отдельно пройти Explore из базового Template;
- повторить ключевой flow с пользовательским Template и кастомной схемой;
- зафиксировать точные revisions, команды, результаты и ограничения пилота.

Пилот считается успешным только по фактически пройденному E2E flow. Unit/integration tests и package dry-run сами по себе пилот не заменяют.

## 4.10. Общая стратегия проверок

После каждого commit выполняются затронутые test files. После каждого этапа выполняются:

```bash
cd harness
npm run check
npm pack --dry-run --cache /private/tmp/multi-repo-specs-npm-cache
node bin/openspec-orch.js --help
git diff --check
```

Дополнительно:

- filesystem/security tests покрывают traversal, symlink escape, специальные файлы, protected paths и collisions;
- fake OpenSpec runner покрывает внешние ошибки и неожиданные JSON-ответы без изменения реального registry/Git state;
- реальные Qwen/GigaCode smoke отмечаются как `Not run`, если соответствующий runtime недоступен;
- проверка одного этапа не должна зависеть от будущего Plugin API.

## 4.11. Реализация Plugins после пилота

Plugins не блокируют выпуск Core/Template. После успешного пилота они реализуются в порядке раздела 3.9:

1. Plugin API, out-of-process host и contract test kit.
2. Read-only Jira/SberTrack Plugin.
3. Explicit Jira/SberTrack writes с idempotency и audit evidence.
4. Документация и SDK для Plugins других команд.

## 4.12. Что не входит в план

- отдельный Toolkit или process-profile слой;
- Core adapter для каждой OpenSpec-схемы;
- собственный planning engine;
- изменение Core-реализацией семантики встроенных OpenSpec skills и commands;
- in-process executable hooks из Template;
- автоматическая установка Plugins;
- публичный Plugin marketplace;
- поддержка недоверенных Plugins без sandbox;
- наследование Project Templates;
- автоматический merge, rollout или Archive;
- изменение `docs/OpenSpec для команды.md`.

## 4.13. Критерии завершения

### 4.13.1. Минимальный прототип Template

Прототип завершён, когда:

1. Публичный CLI использует имя `openspec-orch`, а Core-owned config — `openspec-orch.yaml`.
2. Базовый Template поставляется обычной директорией вместе с Core.
3. Базовый и пользовательский Template применяются одним engine, но никогда не смешиваются.
4. Состав project files определяется `copy`, а не фиксированным списком Core.
5. Удаление `CODEOWNERS`, Explore или необязательной директории не требует изменения Core.
6. Добавление обычного файла или совместимого agent mapping не требует изменения Core.
7. Template может переопределить результат текущего `openspec init`, но не старый пользовательский файл и не защищённый Core path.
8. Partial init возвращает `needs_recovery`; успешный повтор является no-op.
9. Встроенный Template сохраняет текущее поведение Qwen/GigaCode.
10. Все проверки раздела 4.10 проходят.

### 4.13.2. Архитектурное разделение Core/Template

Разделение завершено, когда:

1. Все исполняемые команды `openspec-orch` находятся в Core.
2. Skeleton, schemas и agent-facing assets находятся в Template.
3. Core не содержит process-specific проверок и фиксированных artifact paths.
4. Core получает root и динамические пути из OpenSpec JSON и только валидирует их.
5. `connect` не проверяет необязательные process assets.
6. `change` и `load` не знают `spec-driven`, `proposal.md`, `tasks.md` и фиксированный artifact graph.
7. `init -> connect -> change -> load -> Apply handoff` работает без Explore.
8. Тот же Core работает с базовой и кастомной project-local схемой.
9. Strict mode включён по умолчанию; relaxed mode выбирается только явно и не отключает security-инварианты.
10. Core, OpenSpec и project-local schema обновляются независимо без повторного `init`.
11. Реальный multi-repo пилот пройден и задокументирован отдельно от автоматических tests.

### 4.13.3. Plugins

Plugin subsystem считается отдельным следующим результатом, когда выполнены contracts раздела 3, выпущен read-only Jira/SberTrack Plugin и сторонняя команда может проверить свой Plugin через публичный contract test kit. Он не входит в критерии готовности Core/Template к пилоту.

Итоговая архитектура сохраняет однонаправленное расширение: Project Template проецирует Core в OpenSpec-проект, Plugins расширяют Core, а каждый компонент взаимодействует с нижележащим только через публичный контракт.
