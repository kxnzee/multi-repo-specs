# OpenSpec Orchestrator: продуктовая концепция и scope lock v1

## 0. Статус и назначение документа

Статус документа: **implementation-ready продуктовый и архитектурный scope lock v1**.

Редакция документа: **2**.

Предыдущая редакция сохранена в
[`docs/archive/OpenSpec-Orchestrator-Product-Concept-Brief-v1.md`](archive/OpenSpec-Orchestrator-Product-Concept-Brief-v1.md).

Документ заменяет предыдущую редакцию концепции. Его назначение — зафиксировать продуктовую модель и архитектурные границы настолько полно, чтобы следующий документ мог быть implementation plan, а не продолжением продуктового проектирования.

Документ фиксирует:

- первого пользователя и самостоятельную ценность продукта;
- границы OpenSpec, Orchestrator Core, Project Template и внешнего исполнителя;
- Repository, Change и Assignment/Implementation Layer;
- публичные операции каждого слоя;
- источник истины для Change Binding и Planning Baseline;
- pull-based Handoff contract без скрытого запуска Template-кода;
- точную модель Result Receipt, Snapshot и Verification Receipt;
- правила воспроизводимости, lifecycle и invalidation;
- реалистичный preserve-first Adoption;
- функциональную границу v1 и отдельный distribution gate;
- решения, которые остаётся принять только в implementation plan;
- утверждения, которые допустимо подтвердить только аудитом кода и поддерживаемой версии OpenSpec.

Документ является нормативным для продуктовой модели v1. Термины «обязан», «не должен», «единственный источник истины» и «не входит в v1» задают обязательные ограничения.

Если этот документ конфликтует:

- с материалами из `docs/archive/` — актуален этот документ;
- с текущим CLI — документ описывает целевую модель, а CLI показывает текущее состояние реализации;
- с конкретным Project Template — Template может менять процесс команды, но не границы ответственности Core и OpenSpec;
- с конкретной OpenSpec Schema — Core обязан работать через публичный schema-neutral контракт OpenSpec и не может требовать фиксированные имена артефактов;
- с разделом о текущей реализации из предыдущей редакции — состояние реализации должно быть заново проверено по коду в implementation plan.

Документ не задаёт точный синтаксис CLI, JSON Schema, алгоритмы хеширования, файловые блокировки и migration code. Эти решения относятся к implementation plan, но implementation plan не может менять определённые здесь identities, владельцев, источники истины, lifecycle и границы v1.

## 1. Продукт

### 1.1. Исходная проблема

Продуктовый инженер регулярно реализует один OpenSpec Change в системе из нескольких Git-репозиториев и одного центрального OpenSpec Store. Обычно он заранее знает основной список репозиториев, но вынужден вручную:

- развернуть или восстановить локальный workspace;
- проверить remotes, branches, незавершённые Git-операции и состояние checkout;
- связать Change с участвующими репозиториями;
- зафиксировать, на какой revision Store принят план;
- переносить между командами и сессиями Store ID, repository ID, Baseline, Assignment ID и пути к planning-артефактам;
- объяснять исполнителю границы текущего repository;
- восстанавливать контекст после смены repository или рабочей сессии;
- фиксировать результат реализации каждого repository на точном commit;
- собирать единый набор implementation revisions;
- доказывать, что composite verification относится именно к этому набору revisions и к тому же принятому planning state.

Git, OpenSpec, AI-агент и CI по отдельности не решают эту задачу:

- Git знает commits, branches и remotes, но не знает, какой набор репозиториев реализует один Change;
- OpenSpec владеет Change, Schema и artifact lifecycle, но не обязан координировать локальные checkout нескольких repositories;
- агент или человек может реализовать задачу, но без стабильного технического контекста легко теряет Change, Baseline или repository boundary;
- CI проверяет конкретный commit или job, но сам по себе не связывает несколько проверенных revisions с одним принятым Change и одним Planning Baseline.

### 1.2. Первый пользователь

Первый пользователь — **один продуктовый инженер**, который один или несколько раз в день проводит Change через два или три заранее известных Git-репозитория.

Для функционального v1 не требуется одновременная координация нескольких инженеров. Продукт сначала должен доказать ценность в local-first сценарии одного человека.

После прохождения distribution gate один и тот же Core может независимо использоваться разными командами. Каждая команда может иметь свой Template, OpenSpec Schema, agent-facing commands и verification process.

Необходимо различать:

- **несколько команд независимо используют продукт** — целевой сценарий после distribution gate v1;
- **несколько инженеров обмениваются локальными Receipts и совместно изменяют один runtime state** — следующий этап, не входящий в v1.

В одном проекте v1 используется один активный agent profile. Разные проекты и команды могут выбирать разные agents. Автоматическое переключение между несколькими agent runtimes внутри одного проекта в v1 не требуется.

### 1.3. Определение продукта

OpenSpec Orchestrator — local-first, Git-first и schema-neutral координатор мультирепозиторной реализации OpenSpec Change.

Короткая формулировка:

> Orchestrator связывает один OpenSpec Change с Git-tracked принятым Change Binding, точным Planning Baseline, локальными Assignments, Result Receipts и composite verification на воспроизводимом Snapshot.

Core является координатором процесса, а не planning engine, task tracker, test runner или agent runtime. Он понимает технические identities и связи между Store, Change, Coordination Record, Baseline, Repository, Assignment, Receipt и Snapshot, но не интерпретирует бизнесовый смысл требований и Acceptance Criteria.

### 1.4. Самостоятельная ценность v1

Функциональный v1 должен доказать один сценарий:

> Один инженер проводит один принятый OpenSpec Change через два или три заранее известных репозитория, после принятия scope передавая в ежедневных операциях только `change-id` и не перенося вручную Baseline, Assignment IDs и набор implementation revisions.

Минимальный путь:

```text
(init | adopt) → connect → repository status
    ↓
OpenSpec/Template creates or updates Change
    ↓
[plan(change-id)] → commit planning state
    ↓
assign(change-id, repository IDs)
    ↓
pending Coordination Record → normal Git/PR flow → active acceptance from default-branch history
    ↓
Planning Baseline = acceptance ID + planning revision + accepted Binding
    ↓
status(change-id)
    ↓
implement(change-id) → record assignment receipt
    ↓
repeat for every repository
    ↓
verify(change-id) → exact Snapshot + verification handoff
    ↓
record verification receipt
    ↓
status(change-id) = orchestration verified for that Snapshot
```

`plan` является optional entrypoint. Команда может планировать через существующий OpenSpec/Template process и перейти к `assign`, если planning state уже подготовлен и закоммичен.

### 1.5. Измеримая продуктовая ценность пилота

Пилот считается доказавшим самостоятельную ценность, если одновременно выполнены условия:

1. После принятия Binding пользователь не вводит вручную Baseline, Store ID, Assignment ID или полный список revisions в `implement`, `record`, `status` и `verify`.
2. После перезапуска процесса `status(change-id)` восстанавливает Binding, Baseline и Assignment identities без редактирования local state.
3. Receipt с неверным Change, Baseline, repository, Assignment или revision отклоняется fail-closed.
4. Verification Result невозможно записать для Snapshot, отличного от подготовленного Core.
5. Один и тот же Change проходит не менее чем через два Code Repositories.
6. Custom OpenSpec Schema не требует ветвления Core по имени Schema или имени planning artifact.
7. Adoption не перезаписывает существующий Schema, commands, skills и instructions без явного выбора пользователя.
8. Инженер может вернуться к Change через несколько дней и понять следующее действие только по `status(change-id)`.

### 1.6. Чем продукт не является

Orchestrator не является:

- заменой OpenSpec;
- новым форматом Specs и Changes;
- содержательным planning engine;
- task tracker;
- CI/CD-системой;
- Git hosting platform;
- системой управления релизами;
- agent runtime;
- обязательным агентским фреймворком;
- OS-level sandbox для внешнего агента или человека;
- владельцем Acceptance Criteria;
- механизмом скрытого запуска произвольного кода из Template;
- системой, которая сама принимает архитектурные решения;
- владельцем OpenSpec Archive;
- командным сервером или shared runtime state.

## 2. Зафиксированный scope v1

### 2.1. Функциональный scope v1

В функциональный v1 входят:

1. Один authoritative OpenSpec Store как orchestration root.
2. Один user-owned Git-tracked `openspec-orch.yaml`.
3. Один current logical Core-owned Git-tracked Change Coordination Record на Change; каждый принятый cycle имеет новый `acceptance_id`.
4. Один Core-managed machine-local `.openspec-orch/state.json`.
5. Заранее известный repository registry.
6. Repository roles `store`, `code` или `store+code`.
7. Repository operations: `init`, `adopt`, `connect`, `repository status`.
8. Явный `change-id` во всех Change-level и Assignment-level operations.
9. Optional `plan(change-id)` как подготовка schema-neutral planning Handoff Envelope.
10. `assign(change-id, repository IDs)` как единственная поддерживаемая операция подготовки нового acceptance для Binding и planning revision.
11. Lifecycle Coordination Record `pending → committed → active`: Core готовит record, обычный Git/PR flow делает его committed, а reachability из configured Store default branch — active и authoritative.
12. Не более одного текущего Assignment на repository для сочетания Change и Baseline.
13. `status(change-id)` как read-only aggregate по текущему принятому cycle.
14. `implement(change-id, repository?)` как подготовка Implementation Handoff Envelope.
15. `record assignment` для versioned Result Receipt одного Assignment.
16. Snapshot только из точных Git commits; dirty revisions в Snapshot запрещены.
17. `verify(change-id)` как подготовка и materialization точного Snapshot и Verification Handoff Envelope.
18. `record verification` для versioned Verification Receipt, связанного с точным Snapshot.
19. Schema-neutral работа через публичные структурированные capabilities OpenSpec.
20. Human-readable и versioned JSON output.
21. Явная warning/error/confirmation семантика.
22. Preserve-first `adopt`, не заменяющий существующий OpenSpec/agent process.
23. Pull-based Handoff contract без запуска внешнего process из Core.
24. Внутренний пилот одного реального Change на двух или трёх repositories.
25. Distribution gate перед объявлением продукта готовым для независимого использования разными командами.

### 2.2. Не входит в функциональный v1

В функциональный v1 сознательно не входят:

- `repository sync` как автоматическое обновление существующих checkout;
- `disconnect` как отдельная public command;
- автоматический discovery участвующих repositories;
- Repository Graph и вычисление `affected`;
- автоматическое изменение Change Binding;
- зависимости или порядок выполнения между Assignments как Core-owned model;
- отдельная сущность Project;
- multi-Store orchestration;
- Template Composer, Recipe или автоматический merge Templates;
- Plugin runtime, SDK и marketplace;
- автоматическое чтение или запись Jira, GitHub, Bitbucket, CI и service catalog;
- server-side Control Plane, daemon или индексатор;
- командная синхронизация Result Receipts и Verification Receipts;
- автоматический выбор семантики существующих commands/skills при Adoption;
- автоматическое создание произвольных executable bridges;
- запуск project-specific test commands внутри Core;
- dirty working tree как воспроизводимая implementation или verification revision;
- собственное управление OpenSpec Archive.

Отсутствие этих функций не является дефектом v1.

### 2.3. Граница functional gate и distribution gate

После functional gate продукт может использовать первый инженер в поддерживаемом pilot-проекте.

Продукт нельзя объявлять готовым для распространения в разные команды, пока не пройден distribution gate: clean install, version compatibility, migration, package integrity, минимум два разных Template/Compatibility mapping и внешний pilot.

Distribution gate не добавляет новую продуктовую модель. Он подтверждает переносимость и эксплуатационную готовность уже реализованного functional scope.

## 3. Границы ответственности

### 3.1. OpenSpec

OpenSpec остаётся единственным владельцем:

- Specs;
- Changes;
- schemas;
- artifact graph;
- schema-defined artifacts;
- instructions для создания и проверки артефактов;
- OpenSpec validation и lifecycle;
- штатных OpenSpec commands и skills;
- sync и archive lifecycle.

Core вызывает только публичные, поддерживаемые и структурированные capabilities OpenSpec. Core не вычисляет planning artifact paths по предполагаемому layout и не подменяет OpenSpec собственной реализацией artifact graph.

OpenSpec не обязан предоставлять понятие «accepted planning revision». В v1 принятие Planning Baseline является собственным coordination event Core, определённым командой `assign` и Git-tracked Change Coordination Record.

### 3.2. Orchestrator Core

Core владеет универсальной технической координацией:

- Store и repository identity;
- разбором `openspec-orch.yaml`;
- Change Coordination Record;
- принятым Change Binding;
- разрешением active Coordination Record из configured Store default-branch history и сборкой составного Planning Baseline;
- Assignment identity;
- workspace и exact worktree routing;
- Handoff Envelope;
- Result Receipt и Verification Receipt contracts;
- consistency validation;
- aggregate status;
- exact Snapshot;
- universal orchestration gates;
- semantic fingerprints и invalidation;
- local observed state;
- human и JSON diagnostics.

Core не должен:

- понимать бизнесовую цель Change;
- интерпретировать Acceptance Criteria;
- генерировать содержательный implementation plan;
- требовать конкретные planning artifacts;
- запускать произвольные project-owned commands или skills;
- объявлять project-specific test suite пройденной без внешнего Receipt;
- считать allowed roots техническим sandbox enforcement;
- определять командную методологию;
- блокировать OpenSpec Archive.

### 3.3. Project Template и Compatibility mapping

Project Template определяет team-specific и agent-facing слой:

- начальный OpenSpec config и project-local schemas для нового проекта;
- agent-facing commands, skills, instructions и subagents;
- начальный общий `context`;
- декларативные Handoff mappings;
- project-specific planning, implementation и verification process;
- набор файлов, формирующих verification contract fingerprint.

Template является декларативным набором файлов. После `init` материализованные assets становятся project-owned.

Compatibility mapping для `adopt` является минимальным декларативным описанием уже существующего процесса. Оно может указать существующие entrypoints и contract inputs, но не получает владение существующими files.

Core не исполняет Template или Compatibility mapping. Он только:

1. валидирует mapping и безопасные project-relative paths;
2. формирует versioned Handoff Envelope;
3. показывает или возвращает mapped entrypoint;
4. описывает ожидаемый Result Receipt или Verification Receipt.

### 3.4. Агент или человек

Агент или человек:

- создаёт и читает planning artifacts через OpenSpec/Template process;
- строит локальный implementation plan;
- определяет Tasks и порядок работы;
- изменяет код;
- запускает project-specific checks;
- создаёт структурированный Receipt;
- честно указывает source и Evidence.

Core не хранит рассуждения агента, временный task list или полную историю реализации.

### 3.5. Pull-based Handoff contract

В v1 используется pull-based модель:

1. Project-owned agent-facing command вызывает соответствующую Core operation; прямой вызов человеком остаётся диагностическим/manual путём.
2. Core возвращает Handoff Envelope и mapped entrypoint.
3. Та же project-owned command передаёт Envelope в existing agent workflow, который самостоятельно продолжает process.
4. По завершении внешний исполнитель вызывает `record assignment` или `record verification`.

Core не запускает child process, не вызывает agent API и не интерпретирует Markdown command как executable code.

Если Core вызывается человеком напрямую, human output обязан показать точный следующий entrypoint и способ передать Envelope. Если Core вызывается из agent-facing command, JSON output является машинным контрактом для текущей agent session.

Основной UX не требует copy-paste между Core и агентом: project command сама получает structured Envelope и продолжает существующий flow. Core по-прежнему не запускает агента.

`allowed_read_roots`, `allowed_write_roots` и security boundaries являются обязательной частью контракта и диагностики, но не выдаются за OS-level enforcement. Реальное sandbox enforcement может предоставить agent runtime или будущий Plugin, но не Core v1.

### 3.6. Матрица ответственности

| Объект или операция | Владелец |
|---|---|
| OpenSpec Change, Schema и artifacts | OpenSpec |
| `openspec/config.yaml` | OpenSpec project |
| `openspec-orch.yaml` | Пользователь; Core валидирует |
| Change Coordination Record | Core contract; Git-tracked в Store; пользователь review через Git |
| `.openspec-orch/state.json` | Core; machine-local |
| Repository registry | Пользователь в `openspec-orch.yaml` |
| Planning content | OpenSpec + Template + агент/человек |
| Принятие Binding и Baseline | Пользователь через `assign`; Core фиксирует coordination record |
| Assignment identity | Core |
| Handoff Envelope | Core |
| Agent-facing entrypoint | Project Template или Compatibility mapping |
| Изменение кода | Агент/человек |
| Result Receipt structure и consistency | Core |
| Project-specific checks | Template, агент, человек или CI |
| Snapshot materialization | Core |
| Verification Receipt structure и consistency | Core |
| OpenSpec Archive | OpenSpec и пользовательский процесс |

## 4. Три orchestration layer

### 4.1. Общая последовательность

```text
Repository Layer
init | adopt → connect → repository status
                         │
                         ▼
Change Layer
[plan(change-id)] → assign(change-id, repositories) → status(change-id)
                         │
                         ▼
Assignment/Implementation Layer
implement(change-id, repository) → record assignment(change-id, receipt)
                         │
                         └── repeat for every repository
                                      │
                                      ▼
Change-level verification
verify(change-id) → record verification(change-id, receipt) → status(change-id)
```

Repository Layer используется многократно для разных Changes. Change Layer создаёт один принятый coordination cycle. Assignment/Implementation Layer повторяется для каждого repository из Binding. Verification остаётся Change-level operation, потому что агрегирует все Assignments.

Канонические public operation names фиксируются разделом 7. Точная CLI-грамматика, flags и stdin/file contracts определяются implementation plan.

### 4.2. Repository Layer

#### Назначение

Repository Layer создаёт и восстанавливает технически пригодный local workspace из authoritative Store и заранее объявленных repositories.

Он отвечает на вопросы:

- какой repository является Store;
- какие repositories объявлены пользователем;
- где находятся local checkouts;
- совпадают ли repository ID, canonical remote и role;
- отсутствует ли checkout;
- является ли checkout clean, dirty, diverged или недоступным;
- есть ли незавершённая Git operation;
- можно ли продолжать Change flow;
- какое безопасное ручное действие требуется.

#### Публичные операции Repository Layer

| Операция | Когда вызывается | Результат | Чего не делает |
|---|---|---|---|
| `init` | OpenSpec-проекта ещё нет | Новый project из одного Bootstrap Template, config и first local connect | Не подключает существующий OpenSpec project |
| `adopt` | Валидный OpenSpec project уже существует | Preserve-first Orchestrator config, compatibility report и first local connect | Не переустанавливает Schema, provider pack или командный process |
| `connect` | Project уже создан или принят | Восстановленные local paths и observed connection state | Не меняет существующие branches и не переписывает desired config |
| `repository status` | В любой момент после config discovery | Read-only status Store и всех repositories с diagnostics | Не исправляет drift автоматически |

`repository sync` и `disconnect` не входят в public API v1. До их появления `repository status` обязан давать достаточное объяснение безопасного следующего действия.

#### `init`

`init` предназначен только для создания нового OpenSpec project.

Нормативная последовательность:

1. Выполнить fail-closed read-only preflight.
2. Убедиться, что target не является существующим валидным OpenSpec root.
3. Полностью провалидировать один Bootstrap Template до первой записи.
4. Инициализировать OpenSpec через публичную поддерживаемую capability.
5. Материализовать ровно один Template без автоматического смешивания.
6. Создать начальный `openspec-orch.yaml` и repository registry.
7. Создать необходимую Orchestrator metadata structure.
8. Выполнить first local connect.
9. Показать итоговый `repository status`.

Без явного Template может использоваться один встроенный base Template. Явный Template полностью заменяет base Template; Templates автоматически не объединяются.

После `init` materialized assets становятся project-owned. Обновление Core не перезаписывает их автоматически.

`init` не коммитит и не пушит созданные project files. Пользователь review и commit выполняет обычным Git process.

#### `adopt`

`adopt` предназначен только для существующего валидного OpenSpec project.

Нормативная последовательность:

```text
read-only inspect → explicit mapping resolution → write preview
→ confirmed safe additions → connect → compatibility report
```

`adopt` обязан:

1. Разрешить exact target OpenSpec root через публичные structured diagnostics OpenSpec.
2. Требовать точного совпадения разрешённого root и target path.
3. Проверить Store identity и Git identity.
4. Сохранить существующие OpenSpec config, schemas, Specs, Changes, commands, skills и instructions.
5. Создать только отсутствующий `openspec-orch.yaml`, Orchestrator-owned metadata и local state foundation.
6. Получить Handoff mappings явно: из CLI/interactive answers или из явно переданного Compatibility mapping.
7. Проверить, что mapped paths существуют, безопасны и не конфликтуют.
8. Выполнить first local connect.
9. Вернуть capability report: какие layers готовы, какие handoffs отсутствуют и какие operations пока дадут lazy error.

`adopt` может показать найденные provider directories и candidate files, но не может делать вывод о семантике команды только по имени файла или каталога. Наличие `.qwen/`, `.codex/`, `commands/` или `skills/` не является доказательством того, какой entrypoint выполняет planning, implementation или verification.

`adopt` не создаёт executable bridge автоматически. Project-owned bridge может быть добавлен только если:

- пользователь явно передал Compatibility mapping или Compatibility Template;
- полный diff рассчитан до записи;
- target path свободен;
- пользователь подтвердил добавление;
- bridge остаётся project-owned и не получает скрытых permissions.

Отсутствие handoffs не блокирует Repository Layer. Оно становится lazy error только при вызове соответствующего `plan`, `implement` или `verify`.

#### Fail-closed выбор `init` и `adopt`

| Команда и состояние | Результат |
|---|---|
| `init`, валидного OpenSpec root нет | Продолжить Bootstrap |
| `init`, валидный OpenSpec root есть | Error без записей: использовать `adopt` |
| `adopt`, валидный OpenSpec root есть | Продолжить preserve-first Adoption |
| `adopt`, OpenSpec root отсутствует | Error без записей: использовать `init` |
| Orchestrator уже полностью настроен | Идемпотентная validation + connect |
| Состояние повреждено, конфликтует или неоднозначно | Error с recovery report, без скрытого overwrite |

Core не переключает `init` на `adopt` или наоборот молча.

#### `connect`

`connect`:

- заново читает `openspec-orch.yaml`;
- валидирует Store и repository identities;
- обнаруживает или создаёт machine-local workspace;
- может clone отсутствующий repository по declared remote и default branch;
- не выполняет pull, rebase, merge, reset или branch switch для уже существующего checkout;
- не переписывает config;
- обновляет только local observed state;
- не восстанавливает потерянные Receipts как будто проверки уже выполнялись.

На новой машине `connect` восстанавливает durable Coordination Records и Assignment identities из Git. Machine-local Receipts, Snapshots и Verification Receipts отсутствуют до повторного получения или будущего transport mechanism.

#### `repository status`

`repository status` является read-only operation и показывает как минимум:

- Store identity и path;
- repository registry;
- local path каждого repository;
- missing/connected;
- canonical remote match;
- role match;
- current branch и HEAD;
- clean/dirty;
- незавершённую Git operation;
- diverged или unreachable state, если это можно определить безопасно;
- связанные warnings/errors;
- следующее безопасное действие.

Status не обязан автоматически определять «latest remote revision», если для этого нужен network access. Local facts и remote facts должны быть явно разделены.

#### Критерий готовности Repository Layer

Из чистого окружения можно:

- создать новый project через `init`;
- подключить существующий project через `adopt` без замены его process assets;
- повторно открыть workspace через `connect`;
- получить полный read-only status;
- понять, почему Change flow разрешён или заблокирован, без ручного анализа внутреннего Core state.

### 4.3. Change Layer

#### Назначение

Change Layer связывает один OpenSpec Change с одним текущим принятым coordination cycle:

```text
Change Coordination Record
    = Change ID
    + acceptance ID
    + planning revision
    + accepted repository IDs
    + repository registry fingerprint
```

Planning Baseline этого cycle — составная coordination identity:

```text
Planning Baseline
    = acceptance ID
    + planning revision
    + accepted Change Binding
```

`planning_revision` является exact Git commit Store, но сам Baseline не сводится к специальному Git commit Core.

Change Layer отвечает на вопросы:

- какой Change рассматривается;
- существует ли принятый Coordination Record;
- какие acceptance ID, planning revision и Binding образуют Planning Baseline;
- какие repositories входят в Binding;
- какие Assignment identities следуют из Change + Baseline + Repository;
- какие Assignment Receipts отсутствуют, завершены или невалидны;
- готов ли Change к verification;
- какой Snapshot и Verification Receipt относятся к текущему cycle.

#### Change Coordination Record как источник истины

Для каждого Change Core использует один current logical versioned Git-tracked Coordination Record в Store. Каждый accepted cycle имеет уникальный `acceptance_id`; предыдущие редакции могут оставаться в обычной Git history, но Core не диктует commit topology. Record логически расположен в:

```text
.openspec-orch/changes/<change-key>.json
```

Точный безопасный способ кодирования `change-id` в filename определяет implementation plan. Core не размещает Coordination Record внутри schema-defined OpenSpec artifact path и не требует знания layout Change.

Coordination Record содержит минимально:

- contract version;
- Change ID;
- уникальный `acceptance_id`;
- `planning_revision`: exact clean Store commit с принятым planning state, который Core не создаёт;
- принятый упорядоченный или canonicalized список repository IDs;
- fingerprint соответствующих Repository References;
- `accepted_at` как informational timestamp, не участвующий в identity;
- `accepted_by` как informational actor metadata, не участвующую в identity.

Coordination Record не содержит:

- Tasks;
- Work Packages;
- целей;
- Acceptance Criteria;
- копии Design;
- implementation order;
- содержательного Execution Plan;
- Git governance policy, branch, merge strategy или special commit requirements.

Git-tracked Coordination Record является durable carrier coordination decision. Только его active version является authoritative source of truth для current acceptance ID, Binding и ссылки на planning revision. `.openspec-orch/state.json` не является их источником.

Repository fingerprints связывают repository ID с canonical remote и другой стабильной identity metadata. Они не включают current branch, current commit, dirty state или implementation progress.

#### Событие принятия Baseline

`assign` является единственной поддерживаемой Core operation, подготавливающей новое принятие.

Для первого принятия Core обязан:

1. Разрешить exact Store и Change.
2. Проверить OpenSpec state через публичный structured contract.
3. Требовать clean index/working tree и отсутствие незавершённой Git operation.
4. Проверить все repository IDs по registry.
5. Разрешить явно принимаемый exact clean Store commit как `planning_revision`; Core не создаёт этот commit.
6. Сформировать proposed Coordination Record с новым `acceptance_id` и `planning_revision`.
7. Показать полный Binding и последствия принятия до mutation.
8. Получить explicit confirmation.
9. Подготовить pending Coordination Record в его нормативном project-relative path.
10. Вернуть success в смысе «pending record подготовлен» и показать, что обычный Git/PR flow ещё должен сделать его committed.

После confirmation `assign` может записать только proposed Coordination Record. Он не выполняет `git add`, `git commit`, `git push`, branch switch, merge, rebase или PR operation. Пользователь проводит файл через обычный Git workflow команды.

Pending/uncommitted Coordination Record не является active acceptance и не разрешает `implement`. Record, committed только в feature branch, также ещё не является active acceptance. Acceptance становится active, когда та же valid record version достижима из configured Store default-branch history, а её `planning_revision` достижима из той же authoritative history. Commit может быть создан, reviewed, squashed, rebased или merged по правилам команды; Core не проверяет special parent/diff topology.

#### Повторное принятие и idempotency

Если текущий active Coordination Record существует и переданы те же Binding и planning revision:

- обычный повторный `assign` возвращает текущий acceptance и Baseline идемпотентно;
- более новый Store `HEAD` сам по себе не создаёт новый Baseline;
- новая planning revision принимается только через explicit refresh/replace intent;
- точная CLI-форма explicit intent определяется implementation plan;
- новый Binding всегда требует нового `acceptance_id`, pending record и confirmation;
- старый cycle остаётся историческим, но не является текущим.

Core не переносит старые Assignment Receipts или Verification Receipt на новый Baseline.

Изменение planning artifacts, Schema или Binding не становится принятым автоматически. Пока пользователь не выполнил явный re-assign, текущий accepted cycle остаётся прежним, а `status` может показать informational drift между Store `HEAD` и Baseline без объявления старого evidence ложным.

#### `plan(change-id)`

`plan` — optional read-only Core entrypoint в project-owned planning process.

Core:

1. Разрешает Store и Change ID.
2. Проверяет Repository Layer.
3. Формирует schema-neutral Planning Handoff Envelope.
4. Включает repository registry, текущий committed Store revision как candidate context и общий user context.
5. Возвращает mapped planning entrypoint.
6. Не запускает entrypoint.
7. Не читает, не интерпретирует и не переписывает planning artifacts.
8. Завершается указанием: planning state должен быть review-нут и committed до нового `assign`.

Если planning handoff не настроен, `plan` возвращает lazy capability error. Это не блокирует прямой переход к `assign` после внешнего planning process.

#### `assign(change-id, repository IDs)`

`assign`:

- не назначает людей;
- не создаёт Tasks;
- не определяет implementation order;
- не выбирает repositories автоматически;
- не принимает текущий Store `HEAD` молча;
- не использует OpenSpec-specific artifact names.

Результат `assign` — pending Coordination Record. Accepted Binding, Planning Baseline и детерминированные Assignment identities появляются после того, как record становится active.

#### `status(change-id)`

`status` ничего не меняет. Он каждый раз:

1. Разрешает Store и Change.
2. Разрешает active Coordination Record из configured Store default-branch history и отдельно обнаруживает pending/committed-pending candidate.
3. Строит Planning Baseline из `acceptance_id`, `planning_revision` и accepted Binding record.
4. Проверяет Repository References.
5. Выводит Assignments.
6. Валидирует local Result Receipts.
7. Валидирует последний Snapshot и Verification Receipt.
8. Показывает current repository только как явный presentation attribute, а не как скрытый filter.

`status` не доверяет local state без проверки Git/OpenSpec identities.

#### Вычисляемая семантика Change status

Exact enum names определяет implementation plan, но JSON model обязан однозначно представлять следующие состояния:

| Семантическое состояние | Условие | Следующее действие |
|---|---|---|
| `unassigned` | Нет active Coordination Record и нет pending candidate | Подготовить planning state и вызвать `assign` |
| `acceptance_pending` | Coordination Record подготовлен в working tree, но ещё не committed | Review-нуть и commit-ить record обычным Git process |
| `committed_pending` | Candidate record committed, но ещё не достижим из configured Store default branch | Провести обычный review/PR/merge flow и обновить локальный authoritative ref |
| `assigned` | Binding/Baseline приняты; Receipts отсутствуют | Выполнять `implement` |
| `implementation_partial` | Есть не все completed Receipts | Завершить недостающие Assignments |
| `ready_for_verification` | Для каждого Assignment есть актуальный completed Receipt | Вызвать `verify` |
| `verification_pending` | Snapshot подготовлен, Verification Receipt ещё не записан | Выполнить mapped verification process и `record verification` |
| `orchestration_verified` | Valid Verification Receipt имеет `pass` для текущего Snapshot | Archive/release flow выполняется вне Core |
| `verification_failed` | Receipt имеет `fail` | Исправить результат и повторить affected cycle |
| `verification_error` | Receipt имеет `error` или `inconclusive` | Исправить execution/evidence и повторить verification |
| `inconsistent` | Identity, contract или Git facts не могут быть согласованы | Исправить причину; confirmation не обходит error |

Термин `orchestration_verified` означает только: universal Core gates прошли и для exact Snapshot записан valid Verification Receipt со status `pass`. Он не означает PR approval, security approval, release approval или независимую проверку CI, если source этого не подтверждает.

#### Критерий готовности Change Layer

По одному `change-id` Core разрешает active Binding и составной Baseline, выводит максимум одно текущее Assignment на repository и показывает aggregate status без ручной передачи Baseline и Assignment IDs.

### 4.4. Assignment/Implementation Layer

#### Назначение

Assignment/Implementation Layer отвечает за реализацию части Change в одном repository.

```text
Assignment identity = Change ID + Planning Baseline + Repository ID
```

Assignment не является Task, Work Package, branch или planning document.

#### `implement(change-id, repository?)`

`implement` подготавливает выполнение, но не выполняет project-owned implementation process.

Core обязан:

1. Перечитать config и проверить Repository Layer.
2. Разрешить active Coordination Record и составной Baseline.
3. Определить repository из current working directory или explicit filter.
4. Проверить, что repository входит в Binding.
5. Вывести детерминированный Assignment ID.
6. Материализовать или переиспользовать exact read-only Store worktree на Baseline.
7. Зафиксировать current code starting revision.
8. Сформировать Implementation Handoff Envelope.
9. Вернуть mapped implementation entrypoint и ожидаемый Result Receipt contract.
10. Не запускать entrypoint и не изменять code repository.

Pre-existing dirty code checkout не может быть проигнорирован. Core возвращает warning с точным описанием риска attribution. Interactive continuation возможен только после confirmation; non-interactive continuation требует confirmation token. Наличие dirty state не позволяет позже записать Result Receipt, пока результат не оформлен как clean commit.

Если Store одновременно имеет role `code`, Core использует отдельные worktrees:

- read-only Store worktree на Planning Baseline для planning context;
- writable code checkout для implementation;
- exact implementation worktree на recorded commit для verification.

#### Implementation Handoff Envelope

Envelope содержит как минимум:

- contract version;
- operation `implement`;
- Change ID;
- acceptance ID;
- Planning Baseline;
- repository ID и identity fingerprint;
- Assignment ID;
- Store baseline worktree path;
- code repository path и starting revision;
- allowed read roots;
- allowed write roots;
- security boundary statement;
- user-owned context;
- mapped entrypoint metadata;
- required Result Receipt contract version.

Runtime facts Core имеют приоритет над user context. User context не может переопределить identity, revisions, paths или security boundary fields.

#### `record assignment`

`record assignment` принимает один versioned Result Receipt.

Для local-first v1 Core обязан требовать:

1. Явный `change-id`.
2. Однозначный current repository или explicit repository filter.
3. Совпадение Change, acceptance ID, Baseline, repository и Assignment.
4. Exact Git commit как implementation revision.
5. Наличие commit в ожидаемом repository.
6. Совпадение current checkout `HEAD` с заявленной revision для local source.
7. Clean working tree и отсутствие незавершённой Git operation.
8. Valid source и Evidence structure.

Dirty working tree, stash, uncommitted patch или только tree diff не являются recordable implementation revision v1.

Result Receipt outcome имеет следующую продуктовую семантику:

- `completed` — исполнитель заявляет, что Assignment завершён на exact commit;
- `failed` — попытка завершилась известной ошибкой и не проходит completion gate;
- `blocked` — выполнение невозможно без внешнего решения и не проходит completion gate.

Точные enum spelling определяет implementation plan, но эти три смысла должны быть различимы.

Только актуальный `completed` Receipt допускает Assignment в Change Snapshot.

Новый Receipt не становится current просто по timestamp. Если current Receipt уже существует, новый обязан явно указать его `receipt_id` в `supersedes`. Mismatch является error и защищает от out-of-order result. После valid supersession новый `completed|failed|blocked` Receipt становится current; предыдущий остаётся historical и не участвует в current Snapshot.

Core проверяет structure и consistency, но не заявляет, что самостоятельно повторил project-specific checks. Source и Evidence всегда показываются пользователю.

#### Result Receipt

Минимальный contract включает:

- contract version;
- unique Receipt ID;
- attempt ID;
- optional `supersedes` с exact previous current Receipt ID;
- Change ID;
- acceptance ID;
- Planning Baseline;
- repository ID;
- Assignment ID;
- implementation commit;
- outcome;
- source kind и source identity;
- Evidence list;
- Handoff Envelope digest;
- creation time;
- diagnostic metadata, не участвующую в identity.

В v1 Core хранит current Receipt и минимальную supersession chain: Receipt ID, attempt ID, revision, outcome и previous Receipt ID. Полный event log рассуждений и внешних logs не входит в Core model.

#### Критерий готовности Assignment/Implementation Layer

В каждом repository пользователь передаёт `change-id`; Core автоматически разрешает Assignment и Baseline, предоставляет exact planning context и принимает только clean-commit Result Receipt, согласованный с текущим accepted cycle.

### 4.5. Composite verification

#### Две фазы verification

Verification намеренно разделена на:

1. `verify(change-id)` — Core строит и материализует exact Snapshot, затем выдаёт Verification Handoff Envelope.
2. `record verification(change-id, receipt)` — Core принимает и сохраняет результат внешней project-specific проверки.

Это разделение обязательно, потому что Core не исполняет Template entrypoint и verification может завершиться после отдельной human/agent/CI session.

#### `verify(change-id)`

Core обязан:

1. Разрешить current accepted Change cycle.
2. Потребовать актуальный `completed` Result Receipt для каждого repository из Binding.
3. Проверить exact commits и repository identities.
4. Построить детерминированный Snapshot.
5. Рассчитать verification contract fingerprint.
6. Проверить universal orchestration gates.
7. Материализовать isolated verification workspace на exact commits.
8. Сформировать Verification Handoff Envelope.
9. Сохранить pending Snapshot в local state.
10. Вернуть mapped verification entrypoint и required Verification Receipt contract.
11. Не запускать project-specific checks.

Если любой commit недоступен, любой Receipt невалиден или exact worktree не может быть materialized, `verify` завершается error и не создаёт valid pending verification.

#### Exact Snapshot

Snapshot включает:

- Snapshot contract version;
- deterministic Snapshot ID;
- Change ID;
- acceptance ID;
- `planning_revision`;
- Planning Baseline;
- Coordination Record digest;
- repository ID, identity fingerprint, Assignment ID и implementation commit для каждого Binding entry;
- verification contract fingerprint;
- materialization metadata;
- creation time и source.

`Snapshot ID` вычисляется только из identity projection:

```text
Snapshot ID = hash(
  Snapshot contract version,
  Change ID,
  acceptance ID,
  planning revision,
  canonical Binding entries:
    repository ID + repository fingerprint + Assignment ID + implementation commit,
  verification contract fingerprint
)
```

Creation time, hostname, machine ID, temporary/materialization paths, worktree directory и другая diagnostic metadata могут храниться рядом с Snapshot, но не входят в Snapshot ID.

Snapshot состоит только из Git commits. Поле `dirty` не используется как замена content identity.

Current mutable checkouts не являются verification environment. Core materializes exact worktrees или эквивалентные immutable checkout на указанных commits.

#### Verification Handoff Envelope

Envelope включает:

- exact Snapshot;
- paths exact worktrees;
- read/write boundary verification workspace;
- mapped verification entrypoint;
- user context;
- verification contract fingerprint;
- required Verification Receipt version;
- указание, что результат должен относиться к тому же Snapshot ID.

#### `record verification`

Verification Receipt включает минимум:

- contract version;
- Change ID;
- acceptance ID;
- Snapshot ID;
- verification contract fingerprint;
- Verification Handoff Envelope digest;
- outcome;
- source kind и source identity;
- Evidence list;
- creation time;
- diagnostic metadata.

Verification outcome имеет четыре разных смысла:

- `pass` — project-specific verification завершена успешно;
- `fail` — проверка была выполнена и обнаружила несоответствие;
- `error` — проверка не смогла корректно выполниться;
- `inconclusive` — evidence недостаточно для pass или fail.

Core обязан отклонить Receipt, если Snapshot ID, acceptance ID, verification contract fingerprint или Verification Handoff Envelope digest не совпадают с подготовленным pending verification.

`pass` от агента или человека остаётся результатом с соответствующим source. Core не переименовывает его в independently verified. UI и JSON обязаны показывать source и Evidence рядом с outcome.

#### Критерий готовности Composite verification

Для Change с completed Receipts Core воспроизводимо materializes exact Snapshot, выдаёт project-specific verification handoff и принимает только Verification Receipt, связанный с тем же Snapshot и contract fingerprint.

## 5. Доменная модель v1

### 5.1. Store

Store — authoritative OpenSpec-owned Git repository или Git root с Changes, Specs и schemas. В v1 он одновременно является orchestration root.

Существует ровно один Repository Reference с role `store`. Этот же repository может дополнительно иметь role `code`.

Store не владеет:

- machine-local checkout paths;
- credentials;
- task tracker;
- organisation-wide dependency graph;
- локальными Receipts;
- release lifecycle других repositories.

### 5.2. Repository Reference

Repository Reference — стабильная Git-tracked запись в `openspec-orch.yaml`:

- `repository_id`;
- `roles`: `store`, `code` или оба значения;
- canonical remote URL;
- default branch;
- optional project-owned metadata under explicit extensions.

Repository ID является логической identity внутри Orchestrator project. Remote URL и roles участвуют в identity fingerprint.

Machine-local path не хранится в Git-tracked config.

Core не требует бизнесовых ролей `frontend`, `backend`, `analytics` или `infrastructure`.

### 5.3. Change Coordination Record

Change Coordination Record — Core-defined, Git-tracked и reviewable технический record принятого Change cycle.

Он хранит Binding, `acceptance_id` и exact `planning_revision`, но не содержательный plan.

Любое изменение identity-relevant полей требует нового `acceptance_id` и нового прохождения lifecycle `pending → committed → active`; до состояния `active` новый record не меняет current accepted cycle.

Coordination Record принадлежит Core contract, но находится в пользовательском Git repository. `assign` может подготовить pending file, но Core не stage-ит, не commit-ит и не push-ит его. Пользователь review-ит и распространяет record обычным Git/PR flow.

### 5.4. Planning Baseline

Planning Baseline — не отдельный Git object, а accepted coordination identity:

```text
Planning Baseline
    = acceptance ID
    + exact planning revision
    + accepted Change Binding
```

`planning_revision` — clean commit Store с принятым OpenSpec planning state. Coordination Record доказывает, что к этой revision были приняты конкретные repository IDs под конкретным `acceptance_id`.

Baseline не равен автоматически текущему Store `HEAD`, не зависит от commit, в котором был review-нут Coordination Record, и не требует special parent/diff topology. Если `planning_revision` больше недоступна или недостижима по поддерживаемой Git policy, current acceptance становится inconsistent и требует re-assign.

После принятия Store `HEAD` может двигаться дальше. Текущий Baseline остаётся неизменным до explicit re-assign.

### 5.5. Change Binding

Change Binding — canonical list accepted repository binding entries в Coordination Record. Каждая entry содержит repository ID и fingerprint стабильной Repository Reference identity.

Repository IDs выражают Planning Scope, а fingerprints защищают его от незаметной подмены repository за тем же ID. Binding не включает current branch, current commit, dirty state или implementation progress и не дублирует planning artifacts.

Binding не содержит dependency graph. Core v1 проверяет полноту по всем repositories из списка, но не знает порядок или dependency semantics между ними.

### 5.6. Assignment

Assignment — детерминированная identity:

```text
Assignment = Change ID + Planning Baseline + Repository ID
```

Один accepted cycle имеет не более одного текущего Assignment на repository.

Новый Baseline создаёт новые Assignment identities. Старые не переиспользуются.

### 5.7. Handoff Mapping

Handoff Mapping — декларативная project-owned ссылка на agent-facing entrypoint.

Минимально mapping содержит:

- kind;
- project-relative entrypoint;
- optional declared contract inputs;
- optional project-owned metadata.

Mapping не является executable permission и не запускается Core.

### 5.8. Handoff Envelope

Handoff Envelope — versioned immutable runtime object одного вызова `plan`, `implement` или `verify`.

Envelope объединяет:

- technical facts Core;
- user-owned context;
- mapped entrypoint metadata;
- expected result contract.

Envelope может быть напечатан в JSON, передан через stdin/file или предоставлен текущей agent session. Точный transport определяет implementation plan.

### 5.9. Result Receipt

Result Receipt — versioned local evidence одного Assignment на exact implementation commit.

Receipt доказывает только то, что в нём заявлено, с указанным source. Он не становится CI evidence или independent verification без соответствующего source.

Потеря local Receipt требует повторно получить недоказуемые checks. Она не повреждает Store, Coordination Record или Code Repository.

### 5.10. Snapshot

Snapshot — immutable набор exact commits, используемый для composite verification.

Snapshot identity зависит от:

- current acceptance;
- Baseline;
- repository identities;
- Assignment IDs;
- implementation commits;
- verification contract fingerprint.

Snapshot не зависит от текущих mutable branch names или working-tree state.

### 5.11. Verification Receipt

Verification Receipt — versioned local evidence project-specific verification одного exact Snapshot и одного подготовленного Verification Handoff Envelope.

Receipt не заменяет Snapshot и не может ссылаться только на «текущие branches».

Потеря Verification Receipt требует повторить verification или заново получить доказательство для того же Snapshot.

### 5.12. Evidence

Evidence — структурированное утверждение о проверке.

Минимально Evidence отвечает:

- что проверялось;
- на каком implementation commit или Snapshot;
- кем или какой системой;
- какой command/job/check выполнялся, если он известен;
- какой результат получен;
- где находится внешний reference, если он есть.

Текст «тесты прошли» без identity объекта проверки и source не является достаточным Evidence.

Core не обязан проверять доступность внешнего URL в v1 и не выдаёт наличие ссылки за подтверждение её содержимого.

### 5.13. Fingerprint

Fingerprint — deterministic digest identity-relevant нормализованных данных.

В v1 различаются как минимум:

- Repository Reference fingerprint;
- Coordination Record digest;
- Handoff Envelope digest;
- verification contract fingerprint;
- Snapshot ID.

Алгоритм canonicalization и hash выбирает implementation plan. Он обязан быть versioned и одинаковым в human/JSON semantics.

Verification contract fingerprint обязательно включает:

- contract/fingerprint version;
- verification handoff kind и entrypoint identity;
- content digest самого entrypoint, если это file-backed mapping;
- normalized verification config;
- content digests всех declared contract inputs;
- project-defined gate definitions, которые mapping объявляет частью contract.

Entrypoint входит в fingerprint всегда и не зависит от того, повторил ли автор его в `contract_inputs`.

### 5.14. Gate

Gate — условие перехода внутри lifecycle, которым владеет Core.

Core может запретить считать Assignment completed или Snapshot orchestration verified, но не может запрещать OpenSpec Archive или external release flow.

## 6. Конфигурация, durable metadata и local state

### 6.1. Четыре класса project data

| Data | Владелец | Git | Назначение |
|---|---|---|---|
| `openspec/config.yaml` | OpenSpec project | tracked | Schema и OpenSpec configuration |
| `openspec-orch.yaml` | Пользователь | tracked | Desired Orchestrator config |
| `.openspec-orch/changes/*` | Core contract | tracked | Pending candidates и durable Coordination Records; current acceptance задаёт только active version |
| `.openspec-orch/state.json` | Core | ignored/machine-local | Receipts, Snapshots, local paths и observed state |

Template assets и Compatibility bridges являются project-owned Git-tracked files вне Core state.

Это разделение является scope lock. Implementation plan может уточнить filenames, directories и migration, но не может сделать Binding/Baseline machine-local-only или начать коммитить Receipts в v1.

### 6.2. Целевой минимальный `openspec-orch.yaml`

```yaml
version: 1
strict: true

context: |
  Общий agent-facing контекст продукта и команды.

agent:
  id: qwen
  openspec_adapter: qwen
  handoffs:
    plan:
      kind: markdown-command
      entrypoint: .qwen/commands/project-plan.md
      contract_inputs:
        - .qwen/commands/project-plan.md
    implement:
      kind: markdown-command
      entrypoint: .qwen/commands/project-implement.md
      contract_inputs:
        - .qwen/commands/project-implement.md
        - QWEN.md
    verify:
      kind: markdown-command
      entrypoint: .qwen/commands/project-verify.md
      contract_inputs:
        - .qwen/commands/project-verify.md
        - QWEN.md

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main

  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main

extensions: {}
```

Это продуктовая форма, а не окончательная JSON/YAML Schema. Implementation plan может выбрать точные property names, но обязан сохранить:

- versioned strict contract;
- один active agent profile;
- explicit handoff mapping;
- declared contract inputs;
- repository roles как set;
- один Store;
- отсутствие machine-local paths и secrets;
- namespaced `extensions` для opaque project metadata.

### 6.3. Правила config

`openspec-orch.yaml`:

- принадлежит пользователю;
- review-ится через Git;
- перечитывается при каждой operation;
- имеет обязательную supported version;
- в strict mode отклоняет unknown fields вне `extensions`;
- не содержит secrets;
- не содержит local absolute paths;
- не хранит per-Change Receipts, Snapshots или runtime status;
- может быть создан `init` или `adopt`, но дальше редактируется обычным Git process;
- не переписывается `connect`;
- его версия на `planning_revision` является часть принятого planning context.

### 6.4. Handoff Mapping rules

Поддерживаемые logical kinds v1 должны включать как минимум:

- `markdown-command`;
- `skill`;
- `manual`.

Kind описывает presentation и discovery semantics, а не permission на execution.

`entrypoint` и `contract_inputs`:

- project-relative;
- проходят path safety validation;
- не могут выходить за Store/project boundary через traversal или symlink escape;
- читаются только для validation, rendering и fingerprint;
- не исполняются Core;
- могут отсутствовать только для `manual` mode, если mapping содержит достаточную human instruction reference.

`contract_inputs` определяют дополнительные project-owned files, изменение которых меняет semantic contract operation. Сам mapped entrypoint всегда входит в соответствующий contract fingerprint независимо от этого списка.

Для verification изменение любого declared input создаёт новый verification contract fingerprint и делает прежний Verification Receipt неактуальным.

Для implementation изменение handoff contract не делает уже записанный Result Receipt ложным: Receipt остаётся evidence для своего exact commit и Envelope digest. Новые вызовы используют новый Envelope.

### 6.5. Слияние user context и runtime facts

Core формирует Handoff Envelope из:

1. user-owned `context`;
2. runtime facts Core;
3. mapped handoff metadata.

Runtime facts имеют приоритет. User context не может переопределить:

- Change ID;
- acceptance ID;
- Baseline;
- Store/repository identity;
- Assignment ID;
- revisions;
- Snapshot ID;
- mapped entrypoint;
- allowed roots;
- security boundary statement;
- required Receipt version.

Изменение общего `context` само по себе не инвалидирует accepted Binding, Result Receipt или Verification Receipt. Если текст должен являться частью verification contract, project обязан включить соответствующий file/config projection в declared contract inputs. Точный способ projection определяет implementation plan.

### 6.6. Change Coordination Records

Coordination Records:

- versioned;
- Git-tracked;
- находятся в Store вне schema-defined artifact graph;
- пишутся только поддерживаемым `assign` flow;
- не содержат secrets и local paths;
- валидируются при каждом чтении;
- имеют новый `acceptance_id` при identity-relevant изменении;
- позволяют восстановить Binding, Baseline и Assignments на другой машине при наличии Git history.

Lifecycle record:

```text
pending   = `assign` подготовил valid file в working tree
committed = file входит в local Git commit обычного workflow
active    = эта версия record достижима из configured Store default branch,
            а её planning_revision достижима из той же authoritative history
```

Core использует локально доступный ref configured default branch и не выдаёт его за подтверждённый remote state без fetch/network evidence. Record, закоммиченный только в feature branch, остаётся `committed_pending`, пока не попадёт в default-branch history. Это правило не требует one-parent commit, diff-only commit или определённую merge strategy.

Если record существует в working tree, но не committed, `status` показывает pending coordination mutation, а `implement` и `verify` fail-closed.

Если active record невалиден, его `planning_revision` недоступна или repository fingerprints не совпадают с accepted identity, Change state является inconsistent.

### 6.7. Local observed state

Для v1 используется один Core-managed file:

```text
.openspec-orch/state.json
```

Он:

- versioned;
- machine-local;
- исключён из Git;
- записывается атомарно;
- валидируется при каждом чтении;
- не является source of truth для accepted Binding и Baseline;
- может быть полностью удалён без повреждения repositories и Coordination Records.

Минимальное содержимое:

- local workspace/connection identities;
- repository local paths;
- cached derived Assignment IDs;
- Result Receipts;
- pending and completed Snapshots;
- Verification Receipts;
- gate results;
- Envelope digests;
- diagnostic timestamps.

После потери state Core восстанавливает из Git:

- Store;
- repository registry;
- Coordination Records;
- acceptance IDs;
- Baselines;
- Assignment identities.

Core не восстанавливает как доказанные:

- project-specific checks;
- Result Receipts;
- Verification Receipts;
- pending verification workspace.

Они становятся `missing`, а не «предположительно passed».

### 6.8. Exact worktrees и materialization

Core может использовать Git worktrees или эквивалентный безопасный mechanism для:

- read-only Store context на Planning Baseline;
- exact implementation commit inspection;
- composite verification workspace.

Implementation plan определяет filesystem layout, reuse, cleanup и locking.

Product invariants:

- mutable current checkout не подменяет exact worktree;
- worktree identity проверяется до handoff;
- Core не модифицирует exact verification source worktrees;
- missing commit является error;
- checkout с dirty content не включается в Snapshot.

### 6.9. Schema и Template changes

OpenSpec Schema и project-owned Template assets меняются обычным Git/PR flow без повторного `init` или `adopt`.

Изменение current Store files не меняет accepted Baseline автоматически.

Для нового planning state пользователь:

1. изменяет OpenSpec artifacts/Schema/Template process;
2. review-ит и commit-ит изменения;
3. явно вызывает re-assign;
4. принимает новый Coordination Record и Baseline.

Изменение только implementation handoff не требует нового Baseline.

Изменение verification handoff или declared verification contract inputs не требует нового Baseline, но делает предыдущий Verification Receipt неактуальным для нового contract fingerprint.

Несовместимая миграция активного OpenSpec Change остаётся решением владельца OpenSpec process. Core только показывает, что текущий accepted cycle относится к прежнему Baseline.

## 7. Публичный API и управляющая семантика

### 7.1. Public operations

Канонические logical operations v1:

```text
Repository Layer:
init(path, store identity, agent, template, repositories?)
adopt(path, store identity?, agent?, compatibility mapping?, repositories?)
connect(path?)
repository status(repository filter?)

Change Layer:
plan(change-id)
assign(change-id, repository IDs, expected-baseline?, explicit refresh/replace intent?)
status(change-id, repository filter?)
verify(change-id)

Assignment/Result Layer:
implement(change-id, optional repository filter/assertions)
record assignment(change-id, result receipt)
record verification(change-id, verification receipt)
```

Public operation identities и их семантика входят в scope lock.

Implementation plan фиксирует:

- exact CLI command/subcommand grammar;
- positional arguments и flags;
- exact names refresh/replace mode;
- exact pending Coordination Record write, activation detection и confirmation transport;
- stdin/file/JSON transport Receipt;
- exit codes;
- JSON Schema.

Implementation plan не может объединить `assign` с `plan`, `implement` с `record`, `verify` с external execution или `repository status` с Change `status`.

### 7.2. Почему операции разделены

| Операция | Единственная ответственность |
|---|---|
| `plan` | Подготовить schema-neutral planning handoff; не принимать scope |
| `assign` | Подготовить pending acceptance для Binding и planning revision; Core не проводит record через Git, а active он становится только после обычного Git/PR flow и появления в configured default-branch history |
| `implement` | Подготовить Assignment context и implementation handoff; не утверждать завершение |
| `record assignment` | Зафиксировать external result одного Assignment на exact commit |
| `status` | Read-only aggregate; не принимать решения и не исправлять state |
| `verify` | Построить exact Snapshot и verification handoff; не выдумывать result |
| `record verification` | Зафиксировать external result для exact Snapshot |

Это разделение исключает скрытые side effects и позволяет external process завершаться отдельно от Core invocation.

### 7.3. Явный Change ID

Каждая Change-level, Assignment-level и Receipt operation получает explicit `change-id`.

Core не использует:

- hidden active Change;
- «последний открытый Change»;
- предыдущую CLI history;
- branch name как единственный источник identity.

Current repository может определяться из working directory, но при неоднозначности требуется explicit repository filter.

### 7.4. Assertions не выбирают identity

`expected-baseline`, `expected-assignment`, `expected-snapshot` и аналогичные inputs являются assertions для automation.

Mismatch является error. Assertion не является способом выбрать произвольную старую identity.

### 7.5. Warning, confirmation и error

`warning` означает: операция технически может продолжиться, но существует явно описанный риск.

- interactive default — cancel;
- continuation требует explicit confirmation;
- non-interactive первый вызов возвращает `needs_confirmation` без side effects;
- повторный вызов подтверждает конкретный warning code и immutable preview fingerprint.

`error` означает: Core не может сформировать корректную operation.

- confirmation не обходит error;
- ambiguous identity, invalid contract, unavailable commit, dirty record target, unsafe path и unsupported OpenSpec capability являются errors;
- fail-closed error не оставляет operation в состоянии, которое Core выдаёт за successful.

### 7.6. Mutation preview

Любая Core operation, изменяющая Git-tracked project files, обязана до первой записи показать или вернуть structured preview:

- target files;
- created/updated paths;
- identity-relevant diff summary;
- warning codes;
- ожидаемый Git effect;
- явный факт, что local commit не будет создан Core;
- явный факт, что Core не выполнит stage, push, branch switch, merge, rebase или PR operation.

К таким operations относятся `init`, `adopt` и acceptance path `assign`.

### 7.7. Human и JSON output

Human output обязан:

- показывать identities и exact revisions;
- объяснять причины состояния;
- отделять durable facts от local evidence;
- показывать source Evidence;
- предлагать следующее допустимое действие;
- не использовать цвет как единственный carrier смысла.

JSON output обязан:

- иметь versioned envelope;
- содержать те же identities и lifecycle semantics;
- различать success, warning/needs_confirmation и error;
- включать stable machine-readable reason codes;
- быть достаточным для agent-facing command без парсинга human text;
- не скрывать source или assurance level Result/Verification Receipt.

## 8. OpenSpec Schema, public capability boundary и gates

### 8.1. Schema остаётся произвольной

Core не должен содержать условия вида:

```text
if schema == "spec-driven"
if artifact == "proposal"
if artifact == "tasks"
if path == "openspec/changes/<id>/design.md"
```

Для Core schema ID, artifact ID и artifact paths являются opaque values, полученными из публичного structured response OpenSpec.

Допустимы Schema:

- с Proposal, Design и Tasks;
- без Tasks;
- с другими artifact names;
- с другим artifact graph;
- с дополнительными schema-defined gates;
- с whole-change process без адресуемых Work Packages.

Изменение agent-facing способа чтения или создания artifacts требует изменения Template/Compatibility process, а не branch в Core по имени Schema.

### 8.2. Требуемые публичные capabilities OpenSpec

Concept требует, чтобы поддерживаемая версия OpenSpec позволяла через public contract:

- разрешить exact OpenSpec root;
- подтвердить identity Store и Change;
- выполнить machine-readable validation/doctor;
- получить schema-neutral context или references, достаточные для Handoff Envelope;
- работать из exact Store worktree на Baseline;
- зарегистрировать или разрешить Store identity без чтения private internal layout.

Implementation plan обязан проверить эти capabilities на реально поддерживаемых версиях OpenSpec и зафиксировать compatibility matrix.

Если требуемая capability отсутствует, допустимы только два решения:

1. Ограничить supported OpenSpec versions публично документированным диапазоном.
2. Согласовать отдельное изменение product concept.

Недопустимо молча читать private files или копировать internal OpenSpec logic в Core.

### 8.3. Что проверяет Core

Core проверяет только универсальные технические facts:

- response относится к ожидаемому Store и Change;
- root и paths безопасны;
- identities однозначны;
- Coordination Record active и валиден;
- Baseline и implementation commits существуют;
- repository fingerprints согласованы;
- Receipt относится к ожидаемому Assignment;
- Snapshot состоит из exact commits;
- Verification Receipt относится к exact Snapshot и contract fingerprint;
- required handoff mapping объявлен;
- config/state/contract versions поддерживаются.

### 8.4. Gates разных владельцев

| Gate | Пример | Владелец исполнения |
|---|---|---|
| OpenSpec artifact gate | Schema разрешает следующий artifact | OpenSpec |
| Core acceptance gate | Coordination Record active и составной Baseline однозначен | Core |
| Core Assignment gate | Completed Receipt относится к exact Assignment commit | Core |
| Core Snapshot gate | Все current Assignments имеют valid completed Receipts | Core |
| Project-specific gate | Интеграционные tests прошли | Template/agent/human/CI |
| Governance gate | PR approved | Человек или external system |

Schema может требовать verification artifact или approval, но сама по себе не доказывает execution внешней команды.

Core не блокирует OpenSpec Archive. Если Archive выполнен вне orchestration flow, Core показывает последний известный coordination state, но не изменяет OpenSpec lifecycle.

### 8.5. Межрепозиторные зависимости

Core v1 не моделирует dependency graph и не вычисляет порядок Assignments.

Universal completion gate формулируется только так:

> Для каждого repository из accepted Binding существует current valid `completed` Result Receipt.

Dependency-specific requirements, mocks, sequencing и contract tests остаются planning/verification semantics Project Template. Если repeated need потребует machine-readable dependency graph, это отдельное расширение после наблюдаемого триггера.

## 9. Lifecycle и invalidation

### 9.1. Главный принцип

Evidence не переносится на новую identity автоматически.

При этом точное evidence не становится ложным только потому, что mutable checkout или Store `HEAD` продвинулись. Оно остаётся связано со своим Baseline, Assignment commit или Snapshot и перестаёт быть current только при явном изменении accepted cycle или его identity inputs.

### 9.2. Current accepted cycle

Для одного `change-id` current cycle определяется текущим active Coordination Record и его `acceptance_id`. Record, существующий только в working tree или только в feature branch, ещё не переключает current cycle.

Новый `acceptance_id`:

- создаёт новый Planning Baseline;
- создаёт новые Assignment identities;
- делает previous cycle historical;
- не копирует Receipts;
- делает previous pending/completed Snapshot не current;
- требует новой composite verification.

Core может хранить ссылки на previous local evidence для diagnostics, но current `status` не смешивает cycles.

### 9.3. Invalidation matrix

| Событие | Binding/Baseline | Result Receipts | Snapshot | Verification Receipt |
|---|---|---|---|---|
| Store `HEAD` продвинулся, re-assign не выполнен | Без изменений; показать info | Остаются valid для своих commits | Остаётся valid для своего cycle | Остаётся valid для своего Snapshot/contract |
| Новый `acceptance_id` | Новый current cycle | Previous не current | Previous не current | Previous не current |
| Изменился список repositories | Требуется новый acceptance | Previous не current | Previous не current | Previous не current |
| Изменился identity fingerprint repository | Current cycle inconsistent до explicit resolution/re-assign | Receipt affected repository invalid | Snapshot invalid | Verification invalid |
| Current code checkout продвинулся после Receipt | Accepted cycle без изменений | Receipt остаётся valid для recorded commit; status показывает drift | Existing Snapshot остаётся точным | Existing Verification остаётся точной для Snapshot |
| Записан valid Receipt, явно superseding current Receipt того же Assignment | Binding/Baseline без изменений | Новый Receipt становится current; previous historical | Previous Snapshot становится non-current | Previous Verification становится non-current |
| Изменился implementation handoff | Без изменений | Existing Receipts остаются valid; new Envelope меняется | Без изменений, пока commits те же | Без изменений |
| Изменился verification handoff или declared contract input | Без изменений | Без изменений | New verification requires new contract fingerprint | Previous Verification становится stale/non-current |
| Изменился общий `context` | Без изменений | Без automatic invalidation | Без automatic invalidation | Без automatic invalidation, если context не объявлен contract input |
| Потерян local state | Восстанавливаются из Git | Missing | Missing | Missing |
| Receipt contract version unsupported | Без изменений | Inconsistent/unsupported | Не строится | Не строится |
| Commit недоступен | Identity сохраняется, operation error | Receipt не может быть подтверждён | Snapshot не materializes | Verification не может быть current |
| Commit с Coordination Record squash/rebase-нут, но тот же valid record остался в default-branch history | Без изменений после повторной validation | Без изменений | Без изменений | Без изменений |
| `planning_revision` после rewrite недоступна/недостижима | Current cycle inconsistent; требуется новый `assign` | Previous не current | Previous invalid | Previous invalid |
| Coordination Record удалён или identity-relevant изменён без нового `acceptance_id` | Current cycle inconsistent | Previous не current | Previous invalid | Previous invalid |

Exact enum spelling `stale`, `superseded`, `non_current`, `inconsistent` определяет implementation plan. Оно обязано сохранять различие:

- evidence относится к старому, но корректному cycle;
- evidence нарушает consistency;
- evidence физически отсутствует;
- evidence имеет отрицательный outcome.

### 9.4. Assignment lifecycle

Logical lifecycle одного current Assignment:

```text
pending
  → implementation handoff prepared
  → completed | failed | blocked receipt recorded
  → any current receipt may be explicitly superseded by a new receipt
```

`implementation handoff prepared` является observed event, но не обязательно долгоживущим task status.

Только `completed` current Receipt участвует в Snapshot.

### 9.5. Verification lifecycle

```text
not_ready
  → ready_for_verification
  → Snapshot prepared / verification_pending
  → pass | fail | error | inconclusive
```

Повторный `verify` с теми же inputs обязан вернуть тот же deterministic Snapshot identity или эквивалентный idempotent result.

Новый current Assignment Receipt или новый verification contract fingerprint требует нового Snapshot.

### 9.6. Recovery после частичного mutation

Implementation plan обязан обеспечить recoverable semantics для `init`, `adopt` и acceptance path `assign`.

Product invariants:

- preview рассчитывается до mutation;
- success не возвращается до проверки postconditions;
- partial file write не выдаётся за accepted Coordination Record;
- active acceptance определяется default-branch reachability и другими Git facts, а не промежуточным local flag;
- повторный вызов либо безопасно завершает operation, либо возвращает recovery report;
- Core не выполняет широкий rollback с удалением user-owned files;
- Core не stage-ит, не commit-ит и не push-ит Coordination Record.

## 10. Целевые end-to-end сценарии

### 10.1. Новый project

1. Инженер создаёт или выбирает Git repository для Store.
2. Запускает `openspec-orch init`.
3. Core fail-closed подтверждает отсутствие валидного OpenSpec root.
4. Пользователь выбирает один Bootstrap Template и задаёт repository registry.
5. Template создаёт начальные OpenSpec и agent-facing assets.
6. Core создаёт `openspec-orch.yaml` и Orchestrator metadata structure.
7. Core выполняет first local connect.
8. `repository status` показывает Store и repositories.
9. Пользователь review-ит и commit-ит project files обычным Git process.

### 10.2. Existing OpenSpec project

1. Инженер запускает `openspec-orch adopt` в exact Store root.
2. Core через public OpenSpec diagnostics подтверждает валидный target.
3. Core read-only проверяет Store identity, config и candidate agent assets.
4. Пользователь явно задаёт или подтверждает Handoff mappings.
5. Core показывает write preview.
6. Core создаёт только отсутствующий Orchestrator config/metadata и явно выбранные bridge assets.
7. Existing Schema, Specs, Changes, commands, skills и instructions остаются неизменными.
8. Core выполняет connect и показывает capability report.
9. Project может быть Repository-ready даже при отсутствии части handoffs.

### 10.3. Planning и принятие Change

1. Change создаётся и планируется штатным OpenSpec/Template process.
2. Инженер optional вызывает `plan(change-id)` и получает Planning Handoff Envelope.
3. Agent/человек завершает planning artifacts.
4. Planning state commit-ится в Store.
5. Инженер вызывает `assign(change-id, repository IDs)`.
6. Core показывает proposed Binding, repository fingerprints и acceptance mutation.
7. Пользователь подтверждает.
8. `assign` атомарно записывает pending Coordination Record, но не stage-ит и не commit-ит его.
9. Core выводит pending acceptance ID, proposed Planning Baseline и Assignment IDs; `status(change-id)` показывает `acceptance_pending`.
10. Пользователь review-ит record и проводит его через обычный Git/PR process команды.
11. Когда та же valid record version становится reachable из configured Store default branch, Core считает её active.
12. Planning Baseline собирается как `acceptance_id + planning_revision + accepted Change Binding`; commit с Coordination Record не становится Baseline.
13. `status(change-id)` показывает current cycle как assigned только после activation.

### 10.4. Реализация в Code Repository

1. Инженер переходит в Code Repository.
2. Вызывает `implement(change-id)`.
3. Core определяет repository и Assignment.
4. Core materializes read-only Store worktree на Baseline.
5. Core возвращает Implementation Handoff Envelope и mapped entrypoint.
6. Agent/человек строит локальный plan и изменяет только разрешённый repository.
7. Project-specific checks выполняются вне Core.
8. Изменения commit-ятся; working tree становится clean.
9. Исполнитель формирует Result Receipt.
10. Вызывается `record assignment(change-id, receipt)`.
11. Core валидирует Receipt и сохраняет его в local state.
12. Цикл повторяется для остальных repositories.

### 10.5. Composite verification

1. `status(change-id)` показывает `ready_for_verification`.
2. Инженер вызывает `verify(change-id)`.
3. Core проверяет current completed Receipts.
4. Core строит deterministic Snapshot.
5. Core materializes exact verification workspace.
6. Core возвращает Verification Handoff Envelope и mapped entrypoint.
7. Agent/человек/CI выполняет project-specific checks вне Core.
8. Исполнитель формирует Verification Receipt с тем же Snapshot ID.
9. Вызывается `record verification(change-id, receipt)`.
10. Core валидирует source, Evidence, Snapshot и contract fingerprint.
11. `status(change-id)` показывает outcome и source.
12. OpenSpec Archive остаётся отдельным действием.

### 10.6. Возврат через несколько дней

1. Инженер вызывает `status(change-id)`.
2. Core перечитывает config, Coordination Record и local state.
3. Core заново находит active Coordination Record в configured default-branch history и собирает из него Planning Baseline.
4. Core проверяет repository identities и commits.
5. Core показывает current Assignments, Receipts, Snapshot и next action.
6. Инженер не вводит Baseline и Assignment IDs вручную.

### 10.7. Новая машина или удалённый local state

1. Инженер clone-ит Store и запускает `connect`.
2. Core читает `openspec-orch.yaml` и Coordination Records.
3. Core восстанавливает accepted Binding, Baseline и Assignment identities.
4. Local Receipts и Verification Receipts отсутствуют.
5. `status(change-id)` честно показывает `missing evidence`, а не предполагаемый success.
6. Инженер повторяет только недоказуемые local checks или использует будущий transport mechanism вне v1.

### 10.8. Store одновременно содержит code

1. Repository Reference Store имеет roles `[store, code]`.
2. Binding явно включает его repository ID.
3. `assign` создаёт обычное Assignment для этого repository.
4. Planning Baseline остаётся составной identity acceptance cycle; его `planning_revision` является exact Store commit.
5. Implementation commit может быть более поздним commit того же Git repository.
6. Core использует разные exact worktrees для Baseline context и implementation revision.
7. Snapshot содержит и Baseline, и implementation commit без смешивания их semantics.

### 10.9. Изменение planning scope

1. Пользователь изменяет planning artifacts и/или список repositories.
2. Изменения commit-ятся в Store.
3. Пользователь вызывает `assign` с explicit refresh/replace intent.
4. Core показывает, что будет создан новый acceptance ID и previous evidence перестанет быть current.
5. `assign` записывает pending Coordination Record с новым `acceptance_id` и не изменяет current cycle до activation.
6. Пользователь проводит record через обычный Git/PR process; после попадания valid version в configured default-branch history она становится active.
7. Новый составной Planning Baseline и новые Assignment IDs становятся current.
8. Old Receipts и Verification остаются historical, но не используются current status.

## 11. Граница следующего implementation plan

### 11.1. Продуктовые решения, которые закрыты этим документом

Implementation plan не должен повторно обсуждать:

1. Первого пользователя: один продуктовый инженер.
2. Local-first и Git-first характер v1.
3. Один authoritative Store.
4. Заранее известный repository registry.
5. Три orchestration layer.
6. Explicit `change-id`.
7. OpenSpec как владельца Change, Schema и artifact lifecycle.
8. Core как владельца coordination identities и universal gates.
9. Template как владельца project-specific process.
10. Pull-based Handoff без запуска внешнего process из Core.
11. Active Change Coordination Record как durable source of truth Binding и принятого coordination decision.
12. Составной Planning Baseline: `acceptance_id + planning_revision + accepted Change Binding`.
13. `assign` как единственную поддерживаемую Core operation подготовки нового acceptance cycle: она пишет pending Coordination Record, но не выполняет Git stage, commit, push, branch switch, merge, rebase или создание PR.
14. Exact clean commits как единственные implementation revisions v1.
15. Separate `implement` и `record assignment`.
16. Separate `verify` и `record verification`.
17. Versioned Verification Receipt с `pass|fail|error|inconclusive`.
18. Exact Snapshot materialization.
19. Repository roles `store`, `code`, `store+code`.
20. Local-only Receipts и Verification Receipts v1.
21. Preserve-first Adoption с explicit mapping.
22. Отсутствие `repository sync` и `disconnect` в v1.
23. Отсутствие dependency graph, Plugin runtime, multi-Store и shared state.
24. Functional gate и отдельный distribution gate.
25. Result Receipt supersession как explicit chain по Receipt ID, а не выбор результата по timestamp.
26. Deterministic Snapshot ID только из contract version и coordination/implementation/verification identities, без diagnostic metadata.
27. Verification contract fingerprint с обязательным entrypoint identity/content и declared contract inputs.
28. Activation Coordination Record по configured Store default-branch history без требований к commit topology или merge strategy.

### 11.2. Что обязан определить implementation plan

Implementation plan обязан определить технические контракты без изменения продуктовой модели:

- exact CLI grammar и command aliases;
- exact config JSON/YAML Schema;
- migration старого config;
- exact Coordination Record Schema;
- safe filename encoding `change-id`;
- algorithm определения lifecycle Coordination Record: `pending`, `committed_pending`, `active`;
- algorithm поиска active record в configured Store default-branch history;
- проверку reachability `planning_revision` из той же authoritative history;
- atomic pending-record write и recovery без управления Git commit topology;
- Assignment ID algorithm;
- Handoff Envelope schemas;
- transport Envelope и Receipts через stdout/stdin/file;
- Result Receipt Schema;
- Verification Receipt Schema;
- Snapshot Schema и deterministic ID;
- fingerprint canonicalization и hash versions;
- exact semantic enum names;
- warning/error/reason codes;
- confirmation token format и preview fingerprint;
- exit codes;
- local state Schema и migration;
- atomic writes и file locking;
- workspace/worktree layout;
- worktree reuse и cleanup;
- repository URL canonicalization;
- symlink/path safety rules;
- exact adoption mapping Schema;
- supported Handoff kinds representation;
- human output structure;
- package layout и release automation;
- characterization, contract, integration и E2E test matrix;
- migration/fate текущих prototype commands.

### 11.3. Что можно решить только после проверки кода и зависимостей

Implementation plan обязан начать с code/dependency audit и не принимать предыдущий implementation inventory на веру.

Только по коду и установленным dependencies можно подтвердить:

- какие CLI handlers реально существуют;
- какие current commands и contracts можно мигрировать;
- текущую path safety и Git safety;
- наличие exact worktree utilities;
- текущую Template materialization semantics;
- поведение parser `openspec-orch.yaml`;
- package visibility и publish readiness;
- наличие и semantics public structured OpenSpec commands;
- поддержку exact root resolution;
- возможность работать с OpenSpec из detached/exact worktree;
- способ Store registration;
- стабильность OpenSpec JSON contracts;
- поддерживаемые Node/OpenSpec versions;
- возможность переиспользовать existing Receipt/context code;
- риски backward compatibility.

Если code audit показывает, что публичной OpenSpec capability, требуемой разделом 8.2, нет, implementation plan не должен подменять её private API. Он обязан зафиксировать compatibility limitation или инициировать изменение concept отдельным решением.

### 11.4. Non-normative implementation inventory

Описание текущей реализации не входит в этот scope lock. Оно должно существовать отдельным dated artifact, привязанным к repository revision.

Причина: product concept должен оставаться стабильным, а code inventory изменяется при каждом commit. Смешивание этих двух типов данных создаёт ложные противоречия и быстро устаревающий scope lock.

## 12. Рекомендуемая структура implementation plan

Следующий документ должен быть implementation plan, разбитым на вертикально проверяемые increments.

### Этап 0. Code audit, contracts и migration

1. Зафиксировать audited repository revision.
2. Построить inventory current CLI, config, state, Template и Git utilities.
3. Проверить public OpenSpec capabilities и version matrix.
4. Зафиксировать migration/fate prototype commands.
5. Определить versioned schemas config, Coordination Record, local state, Envelopes и Receipts.
6. Определить IDs, canonicalization, fingerprints и reason codes.
7. Определить pending Coordination Record write, activation detection и recovery contract.
8. Написать contract tests до functional implementation.

Критерий выхода: разработчик может реализовать contracts без выбора новых product identities или owners.

### Этап 1. Repository Layer

1. Characterization tests существующих `init/connect` paths.
2. Fail-closed разделение `init` и `adopt`.
3. Versioned strict config.
4. Repository roles и identity fingerprints.
5. Preserve-first Adoption с explicit mapping.
6. First local connect после `init/adopt`.
7. Read-only `repository status`.
8. Local state foundation.
9. Recovery tests partial writes.

Критерий выхода: новый и существующий projects безопасно достигают Repository-ready state без automatic process replacement.

### Этап 2. Coordination Record и Change Layer

1. Coordination Record Schema и path strategy.
2. `assign` preview/confirmation.
3. Pending Coordination Record workflow без Git mutation со стороны Core.
4. Activation через configured default-branch history и проверку reachability `planning_revision`.
5. Сборка составного Planning Baseline из `acceptance_id`, `planning_revision` и accepted Binding.
6. Deterministic Assignment IDs.
7. Aggregate `status(change-id)` с `acceptance_pending` и `committed_pending`.
8. Re-assign и current/historical cycle semantics.
9. Tests обычного commit, merge, squash и rebase Coordination Record без требований к topology.
10. Negative consistency tests, включая недоступную `planning_revision`.

Критерий выхода: Binding, Baseline и Assignments восстанавливаются из Git по одному `change-id`.

### Этап 3. Handoff и Assignment result

1. Planning Handoff Envelope и optional `plan`.
2. Implementation Handoff Envelope.
3. Exact Store baseline worktree.
4. One-repository resolution.
5. `record assignment` и Result Receipt.
6. Explicit Receipt supersession и защита от out-of-order result.
7. Clean-commit enforcement.
8. Local recovery и invalidation.
9. Store+code topology test.

Критерий выхода: для каждого repository пользователь вызывает `implement(change-id)` и записывает valid result без ручного Baseline/Assignment ID.

### Этап 4. Composite verification

1. Snapshot Schema и deterministic ID.
2. Exact multi-repository materialization.
3. Verification contract fingerprint с обязательным digest mapped entrypoint, normalized config, declared inputs и gate definitions.
4. Universal gates.
5. `verify` Handoff Envelope.
6. `record verification` и four-outcome model.
7. Status integration.
8. Stale/non-current tests при новом Receipt и contract change.

Критерий выхода: один Change получает honest composite result на exact reproducible Snapshot.

### Этап 5. Functional pilot

Пройти реальный Change через два или три repositories:

```text
connect → [plan] → assign → acceptance_pending
→ normal Git/PR flow → active → status
→ implement → record assignment
→ implement → record assignment
→ verify → record verification → status
```

Пилот обязан проверить positive и negative paths:

- custom Schema;
- restart между operations;
- wrong Baseline/Assignment/commit receipt;
- dirty record attempt;
- pending и committed-pending acceptance;
- обычный merge и squash/rebase Coordination Record без invalidation при сохранении valid content;
- недоступная или недостижимая `planning_revision`;
- re-assign;
- out-of-order Result Receipt и explicit supersession;
- changed verification contract;
- lost local state;
- Adoption existing process;
- Store+code либо отдельный явно документированный topology decision пилота.

### Этап 6. Distribution gate

До распространения в разные команды необходимо:

- определить package name, visibility и release process;
- проверить install в clean environment;
- проверить package contents;
- зафиксировать supported Node/OpenSpec versions;
- документировать config/state/record migrations;
- предоставить минимальный Bootstrap Template;
- проверить минимум два разных Templates или Compatibility mappings;
- проверить Adoption active Change без Schema replacement;
- проверить custom Schema без standard Tasks;
- документировать install, update, doctor и removal;
- исключить secrets/local paths из tracked artifacts;
- выполнить внешний pilot другим инженером;
- подтвердить продуктовые метрики раздела 1.5.

После distribution gate разные команды могут независимо использовать один Core. Shared Receipts transport остаётся отдельным будущим этапом.

## 13. Расширение только по наблюдаемому триггеру

| Наблюдаемая повторяющаяся проблема | Допустимое следующее расширение |
|---|---|
| Пользователи регулярно вручную исправляют safe repository drift | `repository sync` с отдельным safety contract |
| Local workspace требуется явно удалять/отвязывать | `disconnect` |
| Пользователь регулярно не знает участвующие repositories | Repository Graph/discovery |
| Нужен machine-readable порядок Assignments | Dependency model после отдельного product audit |
| Одного pull-based handoff недостаточно для нескольких runtimes | Trusted runtime adapter contract |
| Команды постоянно объединяют несколько Templates | Template Recipe/Composer |
| CI/PR status приходится постоянно переносить вручную | Один read-only Plugin |
| Receipts необходимо передавать между инженерами | Git/shared transport с conflict model |
| Один Store перестал описывать orchestration boundary | Project/multi-Store model |
| Local computation не справляется с общим status | Indexer или Control Plane evaluation |
| Необходим OS-level isolation внешнего исполнителя | Explicit sandbox/runtime capability |

До появления измеримого повторяющегося наблюдения расширение не входит в backlog v1.

Repository Graph, если появится, не смешивается с OpenSpec Artifact Graph: первый описывает relations между repositories, второй — schema-defined artifacts одного Change.

## 14. Основные риски и защиты

### 14.1. Core начинает владеть OpenSpec planning semantics

Риск: Core снова ожидает Proposal, Design, Tasks или specific paths.

Защита: OpenSpec artifacts opaque; public structured capability; contract tests custom Schema и whole-change mode.

### 14.2. Неоднозначный Baseline

Риск: Core использует current `HEAD`, local flag, rewritten commit или arbitrary revision.

Защита: record хранит exact `planning_revision` и accepted Binding; Baseline собирается как `acceptance_id + planning_revision + accepted Change Binding`. Record становится active только из configured default-branch history, а `planning_revision` должна быть достижима по authoritative history policy. Commit topology и способ merge не являются частью identity.

### 14.3. Acceptance mutation повреждает Store

Риск: `assign` оставляет partial record, незаметно меняет current cycle или вмешивается в Git process команды.

Защита: clean preconditions, immutable preview, explicit confirmation, atomic narrow write и postcondition validation. Результат всегда pending; Core не stage-ит, не commit-ит, не push-ит, не переключает branch, не merge-ит, не rebase-ит и не создаёт PR.

### 14.4. Coordination Record превращается во второй plan

Риск: в record начинают добавлять Tasks, goals и execution order.

Защита: минимальный schema; только Change ID, acceptance, Binding и identity fingerprint.

### 14.5. Handoff ошибочно воспринимается как execution

Риск: документация утверждает, что Core «запустил агента» или обеспечил sandbox.

Защита: pull-based contract; Core только формирует Envelope и mapping; security boundaries явно advisory без external sandbox.

### 14.6. Ложное Evidence

Риск: agent/human `pass` показывается как independent CI proof.

Защита: обязательный source, object identity и Evidence; `orchestration_verified` имеет узкое определение; source всегда видим.

### 14.7. Dirty revision попадает в Snapshot

Риск: SHA `HEAD` не описывает фактический tested code.

Защита: Result Receipt и Snapshot принимают только exact commits; dirty/uncommitted result fail-closed.

### 14.8. Verification result относится к другому Snapshot

Риск: checks выполняются после изменения commits или contract.

Защита: Verification Receipt обязан совпадать по Snapshot ID, acceptance ID и verification contract fingerprint.

### 14.9. Config digest инвалидирует всё без причины

Риск: formatting или нерелевантное изменение config делает все evidence stale.

Защита: semantic fingerprints по identity-relevant projections; explicit invalidation matrix; общий context не инвалидирует evidence автоматически.

### 14.10. Adoption незаметно заменяет process команды

Риск: Core угадывает semantic command, повторно устанавливает provider pack или переписывает Schema.

Защита: separate `adopt`, exact root, explicit mapping, preview, preserve-first writes, lazy capability errors.

### 14.11. Local state путают с shared team state

Риск: потеря local state или переход на другую машину воспринимается как потеря accepted scope либо продукт объявляется multi-user.

Защита: Binding/Baseline Git-tracked; Receipts local; recovery semantics documented; shared transport вне v1.

### 14.12. Store+code смешивает Planning Baseline и implementation commit

Риск: один SHA используется сразу в двух ролях.

Защита: roles set, distinct identities Baseline и implementation revision, separate exact worktrees.

### 14.13. Private OpenSpec API становится скрытой зависимостью

Риск: Core читает internal layout, потому что public capability неудобна.

Защита: compatibility matrix, fail-closed unsupported version, изменение concept вместо скрытого обхода.

### 14.14. Scope v1 снова разрастается

Риск: sync, Graph, Plugins, adapters и shared state добавляются до доказательства основного cycle.

Защита: functional scope раздела 2 и trigger table раздела 13 являются обязательными scope gates.

## 15. Источники идей и границы заимствования

Концепция использует общие идеи существующих инструментов, не копируя их целиком:

- OpenSpec — Change, Schema, artifact lifecycle и project-local customization;
- Git commits/worktrees — exact planning/implementation revisions и isolated materialization составного Baseline/Snapshot;
- CI matrix — агрегирование нескольких component revisions;
- reproducible build systems — identity входов без превращения Core в build engine;
- workspace manifests — восстановление local environment;
- plugin architectures — будущая explicit capability boundary вместо hidden hooks;
- agent commands/skills — заменяемая методология поверх стабильного Core contract.

Главный архитектурный принцип: OpenSpec владеет содержанием Change, Project Template владеет способом работы команды, а Orchestrator Core владеет только универсальной technical coordination между repositories и evidence.

## 16. Финальный scope lock v1

OpenSpec Orchestrator v1 концептуально определён следующим образом:

1. Первый пользователь — один продуктовый инженер.
2. Основной сценарий — один Change через два или три заранее известных repositories.
3. Один authoritative OpenSpec Store является orchestration root.
4. Один repository может иметь roles `store`, `code` или `store+code`.
5. OpenSpec владеет Change, Schema, artifacts и Archive.
6. Core не интерпретирует Acceptance Criteria и не создаёт содержательный plan.
7. Template/Compatibility mapping владеет project-specific process и entrypoints.
8. Core не запускает Template code, agent runtime или project-specific commands.
9. Handoff является pull-based versioned Envelope + declarative mapping.
10. `allowed roots` не выдаются за OS-level sandbox.
11. Существуют три layers: Repository, Change, Assignment/Implementation.
12. Repository operations v1: `init`, `adopt`, `connect`, `repository status`.
13. `repository sync` и `disconnect` не входят в v1.
14. Change operations v1: optional `plan`, `assign`, `status`, `verify`.
15. Result operations v1: `record assignment`, `record verification`.
16. Каждая Change/Assignment/Receipt operation получает explicit `change-id`.
17. Change Binding хранится в Core-defined Git-tracked Coordination Record.
18. Coordination Record содержит `acceptance_id`, `planning_revision` и repository IDs, но не Tasks или Design.
19. Planning Baseline — составная identity `acceptance_id + planning_revision + accepted Change Binding`, а не commit с Coordination Record.
20. `assign` — единственная поддерживаемая Core operation подготовки нового acceptance cycle; после confirmation она записывает pending Coordination Record и не выполняет Git stage/commit/push или управление branches/PR.
21. Coordination Record имеет lifecycle `pending → committed_pending → active`; только active record переключает current accepted cycle.
22. Store `HEAD` не rebase-ит current Baseline автоматически.
23. Один current Assignment существует на repository для Change + Baseline.
24. Assignment identity не зависит от Tasks, Work Packages или branch name.
25. `implement` только подготавливает context и handoff.
26. `record assignment` принимает только exact clean implementation commit.
27. Dirty/uncommitted result не входит в v1.
28. Result Receipt хранится machine-local и сохраняет honest source.
29. `verify` строит и materializes exact Snapshot, но не запускает tests.
30. `record verification` принимает отдельный Verification Receipt.
31. Verification outcome различает `pass`, `fail`, `error`, `inconclusive`.
32. `orchestration_verified` не означает governance/release approval.
33. Verification Receipt связан с Snapshot ID и verification contract fingerprint.
34. Binding/Baseline восстанавливаются из Git; Receipts после потери state становятся missing.
35. `openspec-orch.yaml` является user-owned desired config.
36. `.openspec-orch/state.json` является machine-local observed/evidence state.
37. Core работает schema-neutral через public OpenSpec capabilities.
38. Unsupported public OpenSpec capability нельзя заменять private layout access.
39. `adopt` preserve-first и использует explicit mapping; semantic auto-discovery не входит в v1.
40. Warning требует explicit confirmation; error confirmation не обходит.
41. Core не stage-ит, не commit-ит и не push-ит Coordination Record, не управляет branch/merge/rebase/PR workflow команды.
42. Functional v1 подтверждается реальным pilot Change.
43. Независимое использование разными командами разрешается только после distribution gate.
44. Shared Receipts, Graph, Plugins, multi-Store, Composer, automatic CI integration и Control Plane не входят в v1.
45. Implementation plan может определить technical schemas и algorithms, но не переоткрывает перечисленные product decisions.
46. Новый Result Receipt supersede-ит current Receipt только по explicit previous Receipt ID; timestamp не выбирает current result.
47. Snapshot ID детерминирован и не включает timestamp, hostname, machine ID или materialization paths.
48. Verification contract fingerprint всегда включает mapped entrypoint identity и его content digest для file-backed mapping, даже если entrypoint не указан в `contract_inputs`.
49. Squash/rebase commit с Coordination Record не инвалидирует acceptance, если та же valid record version остаётся в configured default-branch history; rewrite или недостижимость `planning_revision` требует нового `assign`.

Следующий нормативный документ — implementation plan этапов 0–6 раздела 12. Он обязан начинаться с code/dependency audit, быть привязан к exact repository revision и реализовать этот scope без расширения продуктовой модели.
