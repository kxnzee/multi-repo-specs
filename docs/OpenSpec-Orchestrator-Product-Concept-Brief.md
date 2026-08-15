# OpenSpec Orchestrator: продуктовая концепция, scope lock и план развития

## 0. Назначение документа

Этот документ начинался как контекст отдельного разговора о будущем OpenSpec
Orchestrator без привязки к форме текущего прототипа. Grilling-сессия завершена, и
теперь документ также фиксирует минимальную модель и границы первой полезной версии.

Его следует использовать как исходный контекст для продуктового, доменного и архитектурного брейншторма. Текущие команды, имена файлов и уже написанный код не считаются обязательной формой будущего продукта. Они рассматриваются только как накопленный опыт: какие проблемы уже проявились, какие границы оказались полезны и какие решения мешают дальнейшему развитию.

Для перехода к реализации сначала нужно читать разделы 3.1, 3.2, 3.3, 22, 26 и 28. Они
имеют приоритет над ранними рабочими гипотезами. Остальные подробные разделы сохраняют
обоснования, отвергнутые варианты и идеи будущего развития, но не расширяют v1.

Документ помогает решать:

- что должно остаться в Orchestrator Core;
- что должно принадлежать OpenSpec;
- что должно поставляться через Project Template;
- что должно быть подключаемым skill или methodology bundle;
- что требует исполняемого Plugin;
- какие команды и форматы конфигурации действительно нужны;
- какие части текущего прототипа следует сохранить, перепроектировать или удалить.

Документ не является финальной архитектурой или спецификацией реализации. Он является
scope lock для следующего implementation planning и не обязывает сохранять текущий CLI.

## 1. Как читать статус утверждений

В документе используются три типа утверждений:

- **Принцип** — граница, которая уже выглядит устойчивой и должна нарушаться только после явного пересмотра.
- **Рабочая гипотеза** — наиболее логичное на данный момент направление, которое необходимо проверить сценариями и прототипами.
- **Открытый вопрос** — решение пока не принято; его нельзя молча превращать в требование к реализации.

## 2. Исходная проблема

Команды всё чаще работают не с одним репозиторием, а с системой взаимосвязанных репозиториев:

- frontend зависит от API backend;
- несколько сервисов совместно реализуют один пользовательский сценарий;
- библиотека публикует контракт, который потребляют несколько приложений;
- инфраструктурный репозиторий определяет способ развёртывания прикладных сервисов;
- требования и Change могут храниться отдельно от исходного кода;
- одна задача требует согласованных изменений и проверки нескольких revisions;
- один и тот же репозиторий может участвовать в нескольких продуктах или проектах.

Git, OpenSpec, AI-агенты, CI и task tracker решают отдельные части этой задачи, но не дают единой модели рабочего контекста:

- Git знает commits и branches, но не знает продуктовый Scope;
- OpenSpec знает Specs, Changes, schemas и artifact graph, но не обязан управлять checkout нескольких репозиториев;
- AI-агент умеет читать код и выполнять инструкции, но без ограниченного и воспроизводимого контекста легко теряет границы задачи;
- CI знает результаты конкретных job, но не знает, какие revisions нескольких репозиториев вместе образуют проверенную реализацию Change;
- task tracker знает организационную работу, но не является источником требований или технической топологии.

В результате разработчик вручную отвечает на повторяющиеся вопросы:

1. Какие репозитории относятся к проекту?
2. Какие из них затрагивает текущая задача?
3. Почему они были выбраны?
4. Какие точные revisions анализировались?
5. Какие Changes и Specs являются нормативным контекстом?
6. Какие команды и skills должна использовать эта команда?
7. Какие проверки действительно выполнены?
8. Можно ли продолжать работу, передавать её другому агенту или архивировать Change?

## 3. Продуктовая гипотеза

**Рабочая гипотеза:** OpenSpec Orchestrator — это schema-neutral слой управления мульти-репозиторным рабочим контекстом поверх OpenSpec.

Он должен:

- знать объявленный состав Store Context;
- фиксировать принятый список repositories конкретного Change;
- фиксировать точные revisions в воспроизводимом Snapshot;
- подготавливать проверенный Handoff для агента, человека или автоматизации;
- принимать минимальный Result Receipt по каждому repository;
- показывать общее состояние multi-repository Change;
- использовать OpenSpec как движок Specs, Changes, schemas и artifact lifecycle;
- позволять команде полностью настраивать agent-facing процесс через Template, commands и skills;
- не мешать кастомной OpenSpec Schema и не интерпретировать её бизнесовую семантику.

Короткая формулировка ценности:

> Orchestrator превращает набор связанных Git-репозиториев и OpenSpec Store в воспроизводимый рабочий контекст для планирования, реализации и проверки Change.

Альтернативная формулировка для дальнейшей проверки:

> Schema-neutral multi-repository workspace and evidence engine for OpenSpec-based development.

### 3.1. Зафиксированные решения grilling-сессии

Следующие решения уточняют исходный бриф и имеют приоритет над более ранними
гипотезами документа:

1. Первый пользователь продукта — один продуктовый инженер, регулярно получающий
   и реализующий задачи в системе из нескольких репозиториев.
2. Первая проблема — не поиск неизвестных зависимостей, а контролируемая связь
   одного принятого OpenSpec Change с заранее известным списком Code Repositories.
3. Repository Graph, автоматический discovery и вычисление `affected` не являются
   обязательным ядром первой полезной версии. Они могут появиться позже для задач,
   где список репозиториев заранее неизвестен.
4. В продукте различаются три orchestration layer:
   - Repository Layer: подготовка и поддержание локального набора репозиториев;
   - Change Layer: связь принятого Change, Baseline, Change Binding и общего статуса;
   - Assignment/Implementation Layer: выполнение одного Assignment в конкретном
     repository, фиксация Result Receipt и проверка результата.
   Эти слои образуют два более широких цикла: Repository Lifecycle относится к
   Repository Layer, а Change Execution Lifecycle проходит через Change Layer и
   Assignment/Implementation Layer. Слои не являются новыми программными компонентами
   и не заменяют разделение ответственности между Core, Template и OpenSpec.
5. Planning Scope — принятый список репозиториев Change. Он входит в планирование,
   потому что определяет Design и распределение работ. Обнаружение дополнительного
   репозитория требует обновления planning-артефактов, повторного согласования и
   нового Baseline.
6. Идеальный implementation UX: инженер указывает Change, а Orchestrator по принятому
   Baseline сам определяет Assignment текущего репозитория без ручного переноса
   Work Package IDs и других служебных параметров.
7. Целевой уровень Core — координатор процесса. Core понимает идентичность Change,
   Baseline, Repository, Assignments, зависимости исполнения и обязательное Evidence,
   но не интерпретирует бизнесовый смысл цели или Acceptance Criteria.
8. Первая самостоятельная версия является local-first продуктом для одного человека.
   Командная координация — следующий этап масштабирования, а не условие полезности v1.
9. Сервер Orchestrator не требуется. Продукт использует Git-first модель: принятое
   общее состояние хранится в Git, а локальный Core собирает, проверяет и изменяет его
   через явные операции. Отдельный Control Plane или серверная база не входят в
   текущую целевую модель.
10. Один Change создаёт не более одного Assignment на каждый участвующий repository.
    Внутренние Tasks, Work Packages и их порядок остаются содержанием принятого
    плана. Для Core Assignment является технической координационной идентичностью
    `Change + Baseline + Repository`, а не отдельным содержательным планом.
11. Межрепозиторная зависимость не блокирует начало реализации Assignment. План может
    разрешать параллельную работу, mocks или разработку по принятому контракту. Core
    учитывает такую зависимость только при переводе Assignment в `verified` и при
    composite verification: неподтверждённую совместимость нельзя выдать за
    проверенный результат.
12. Core не генерирует, не интерпретирует и не кеширует содержательный implementation
    plan. Он формирует технический Implementation Context с точными runtime facts.
    Template и агент читают произвольные planning-артефакты, строят локальный план и
    реализуют его. В Core возвращается только schema-neutral Result Receipt.
13. В принятом Planning Baseline фиксируется минимальный Change Binding — связь Change
    со списком участвующих repository IDs. Binding не содержит Tasks, целей, порядка
    реализации или копии Design и потому не является дублирующим Execution Plan.
14. Пользователь задаёт исходный список repositories для Change Binding. Planning-agent
    может предложить добавление или удаление repository только с причиной и Evidence.
    Пользователь явно подтверждает итоговый Binding, после чего Planning PR принимает
    его вместе с остальными planning-артефактами на одном Baseline. После принятия
    изменение Binding требует нового planning-согласования.
15. В первой версии OpenSpec Store является orchestration root. Отдельной сущности
    Project, собственного Project ID и multi-Store lifecycle нет. Возможный Project
    откладывается до появления реального сценария нескольких Stores или нескольких
    независимых orchestration configurations поверх одного Store.
16. Project Template остаётся декларативным: schemas, config, context, commands,
    skills, instructions, обычные project assets и handoff mappings. Core не запускает
    hooks или произвольный исполняемый код из Template. Будущие executable extensions
    принадлежат отдельным Plugins с явными capabilities, permissions и trust boundary;
    Plugin runtime не требуется для первой версии.
17. Result Receipt имеет небольшой versioned schema-neutral контракт, реализуемый в
    Core через runtime validation, например Zod. Core проверяет структуру, согласованность
    полей и доступные универсальные Git/OpenSpec-факты. Project-specific checks не
    перезапускаются Core и остаются явно помеченным отчётом агента или человека.
18. В local-first v1 Result Receipts хранятся в Core-managed local state до composite
    verification. Они не создают отдельные commits в Store или Code Repositories.
    Git-перенос Receipts рассматривается только при масштабировании на команду.
19. В local-first v1 project-specific composite verification выполняет Template,
    агент или человек вне Core. Core собирает точный Snapshot и проверяет наличие
    актуальных Result Receipts, после чего получает простой результат проверки:
    `pass|fail`, источник и Snapshot. Отдельные Composite Verification Context и
    Composite Verification Receipt как доменные сущности в v1 не нужны.
20. Core применяет gates только к состояниям собственного orchestration lifecycle и
    не забирает ответственность за OpenSpec Archive. Если пользователь сознательно
    архивирует Change в обход orchestration gates, Core не блокирует действие, а
    показывает состояние последнего gate как `missing`, `failed` или `stale` и
    объясняет, какое условие процесса не выполнено.
21. Публичный API строится по слоям и не зависит от скрытого «активного Change».
    Любая операция Change-layer, включая status, implement, record и verify, каждый
    раз получает явный Change ID. Команды одного слоя по возможности используют
    одинаковый набор и одинаковые имена входных параметров. Core не угадывает
    пропущенную identity из истории предыдущих вызовов и fail-closed при
    неоднозначности.
22. Baseline не является обязательным ручным параметром обычных Change-layer команд.
    Core разрешает его из принятой planning revision, фиксирует на время операции и
    всегда показывает в human/JSON output и результате. Существующая Assignment не
    переключается на новый Baseline молча. Необязательный `expected-baseline` может
    использоваться автоматизацией только как assertion: несовпадение останавливает
    операцию, а не выбирает произвольную старую revision.
23. `warning` и `error` имеют разную управляющую семантику. Warning всегда требует
    явного выбора пользователя: продолжить или отменить, с default `cancel`. В
    non-interactive API Core сначала возвращает `needs_confirmation` без побочных
    эффектов, а повторный вызов должен явно подтвердить конкретный warning code.
    Error завершает операцию без варианта «продолжить»; неоднозначная identity,
    отсутствующий обязательный Baseline и другие условия, при которых Core не может
    сформировать корректную операцию, подтверждением не обходятся.
24. Для продолжения работы между запусками v1 использует один небольшой versioned
    local state document на Store Context/workspace. Он не коммитится и хранит только
    Assignment identities, Result Receipts, gate results и связанные точные
    revisions. При каждом чтении Core валидирует формат и перепроверяет ссылки по
    Git/OpenSpec; несовпадение даёт `stale`. Запись выполняется атомарно. Потеря или
    повреждение state не повреждает Store или code repositories: Core восстанавливает
    вычислимую часть из Git, а недоказуемые проверки требуется повторить.
25. `status(change-id)` по умолчанию показывает весь multi-repository Change: Baseline,
    все Assignments, их состояния, composite verification и последний gate. Текущий
    repository, если он однозначно определяется, только визуально выделяется в human
    output и получает `is_current: true` в JSON. Он не ограничивает результат
    неявно; локальное представление требует явного repository filter.
26. `openspec-orch.yaml` является единой user-owned declarative конфигурацией
    желаемого состояния Orchestrator в Store. Все её поддерживаемые поля можно менять
    вручную и review через Git. `init` только создаёт стартовый файл из Template, а
    `connect` его не переписывает. Каждая новая Core-операция заново читает и
    валидирует config, сравнивает желаемое состояние с локальным observed state и
    сама сообщает, требуется ли дополнительное действие. Конкретный запущенный вызов
    фиксирует использованную config revision или digest.
27. Второй Git-tracked Orchestrator config в v1 не вводится. Machine-local connection,
    Result Receipts и gate results принадлежат Core-managed
    `.openspec-orch/state.json`. Это observed state, а не конфигурация пользователя.
    Возможный `openspec-orch.lock.yaml` откладывается до появления реального lifecycle
    версий Template, Plugins или Methodology Bundles.
28. Конфигурация v1 остаётся минимальной: в одном `openspec-orch.yaml` есть один общий
    текстовый `context`, существующий agent handoff mapping и repository registry.
    Отдельные operation-specific instructions, универсальный entrypoint registry,
    второй config, Template composition и config language не добавляются до появления
    подтверждённой проблемы. Специфический способ `plan/implement/verify` остаётся в
    Template handoff command/skill, который при необходимости использует Superpowers,
    Matt Pocock skills или собственную методологию команды.

### 3.2. Зафиксированная минимальная модель

После grilling-сессии дальнейшее расширение концепции остановлено. Первая полезная
версия должна доказать только один сценарий:

> Один продуктовый инженер проводит один принятый OpenSpec Change через реализацию в
> заранее известных repositories, не перенося вручную Baseline, Work Package IDs и
> состояние работы между сессиями.

Минимальный путь пользователя:

```text
init/connect
    ↓
Change + accepted Binding + Baseline
    ↓
status(change-id)
    ↓
implement(change-id) в каждом repository через Template handoff
    ↓
Result Receipts
    ↓
verify(change-id) на точном Snapshot
```

Минимальный `openspec-orch.yaml` развивает существующий контракт, а не вводит новый
язык конфигурации:

```yaml
version: 1
strict: true

context: |
  Общий контекст продукта и команды для agent-facing Handoff.

agent:
  id: qwen
  openspec_adapter: qwen
  architecture: markdown-commands
  commands_directory: .qwen/commands
  instructions_file: QWEN.md
  handoffs:
    implement: .qwen/commands/project-implement.md
    verify: .qwen/commands/project-verify.md

repositories: []
```

`context` перечитывается при каждом новом agent-facing вызове. Template создаёт его
начальное значение, после чего пользователь может свободно редактировать файл. Core
добавляет точные Change/Baseline/Repository/revision facts и не разрешает context
перезаписывать их. Operation-specific методология остаётся в handoff command/skill.

Не входят в минимальную модель:

- Repository Graph, discovery и `affected`;
- operation-specific context в YAML;
- Template Recipe/Composer и обновление bundles;
- Plugin runtime;
- сервер, Control Plane и командная синхронизация Receipts;
- отдельный Project и multi-Store;
- собственное управление OpenSpec Archive.

### 3.3. Каноническая трёхслойная модель orchestration

Этот раздел фиксирует итоговую модель после brainstorming и grilling-сессии. Он имеет
приоритет над более ранними местами документа, в которых Change Execution мог
рассматриваться как один неразделённый слой.

#### 3.3.1. Две независимые оси модели

В продукте одновременно существуют две разные классификации:

1. **Orchestration layers** описывают, с каким объектом и на каком масштабе сейчас
   работает пользователь:
   - Repository Layer;
   - Change Layer;
   - Assignment/Implementation Layer.
2. **Responsibility owners** определяют, какой компонент владеет конкретным типом
   данных и поведения:
   - OpenSpec;
   - Orchestrator Core;
   - Project Template;
   - будущий Plugin только для явно подключённой исполняемой интеграции.

Нельзя располагать `OpenSpec`, `Core` и `Template` рядом с Repository, Change и
Assignment как элементы одной иерархии. Например, операция Implementation Layer
одновременно использует:

- OpenSpec как источник принятого Change и его planning-артефактов;
- Core как владельца Assignment identity, точных revisions и Result Receipt contract;
- Template как владельца agent-facing способа реализации;
- агента или человека как фактического исполнителя работы.

Компоненты взаимодействуют через публичные контракты. Требование «не пересекаться»
означает отсутствие скрытого владения и вмешательства во внутреннюю логику друг
друга, а не отсутствие любых вызовов между компонентами.

#### 3.3.2. Общая последовательность

Слои связаны последовательно, но имеют разную частоту использования:

```text
Repository Layer
init → connect → repository status/sync → disconnect
                         │
                         ▼
Change Layer
plan outside Core → accept Binding + Baseline → derive Assignments → aggregate status
                                                     │
                                                     ▼
Assignment/Implementation Layer
prepare context → implementation handoff → record Result Receipt → verify on Snapshot
```

- Repository Layer обычно настраивается один раз и затем используется для многих
  Changes; `status/sync` вызываются по мере повседневной работы.
- Change Layer начинается для каждого нового Change и всегда работает с явным
  `change-id`.
- Assignment/Implementation Layer создаёт максимум одну Assignment identity на каждый
  repository из принятого Change Binding. Операции реализации и внутренние итерации
  агента для этой Assignment могут повторяться сколько угодно раз.

Переход на следующий слой не передаёт ему владение данными предыдущего. Например,
Assignment ссылается на Change и Baseline, но не копирует их бизнесовое содержание.

#### 3.3.3. Repository Layer

**Назначение**

Repository Layer создаёт и поддерживает технически пригодный локальный workspace из
OpenSpec Store и заранее объявленных Code Repositories. Он отвечает на вопросы:

- какой Store является orchestration root;
- какие repositories объявлены пользователем;
- где находятся их локальные checkouts;
- совпадают ли repository identity, remote и default branch с конфигурацией;
- можно ли безопасно читать, обновлять или отключать checkout;
- какие локальные проблемы необходимо исправить до работы с Change.

**Главная пользовательская ценность**

Инженер один раз объявляет известный состав repositories и дальше не собирает
окружение заново для каждой задачи. При возвращении к работе он получает проверенный
workspace и понятное объяснение stale, dirty, missing или diverged состояния.

**Входы**

- user-owned `openspec-orch.yaml`;
- Store identity и Git remote;
- repository registry с ID, URL и default branch;
- выбранный Project Template только во время `init`;
- фактическое состояние локальной машины и Git checkouts.

**Выходы**

- созданный или обнаруженный Store Context;
- проверенные локальные пути Store и Code Repositories;
- observed connection state;
- repository-level status и diagnostics;
- безопасно обновлённые checkouts либо явный warning/error без скрытого изменения.

**Целевой lifecycle**

```text
init → connect → status → safe sync → disconnect
```

- `init` создаёт Store Context, вызывает публичный `openspec init`, применяет один
  выбранный Template и создаёт начальный `openspec-orch.yaml`.
- `connect` перечитывает config, регистрирует Store штатными средствами OpenSpec,
  обнаруживает или создаёт workspace и подключает объявленные repositories.
- repository `status` сравнивает desired config с фактическими checkouts и ничего не
  меняет.
- safe `sync` обновляет только однозначно определённые и безопасные checkouts. Dirty,
  diverged или неоднозначное состояние не исправляется молча.
- `disconnect` удаляет только машинную связь и вычислимый observed state. Он не
  удаляет удалённые repositories, Change или пользовательские файлы. Точный состав
  локально удаляемых данных должен быть определён implementation contract.

`disconnect` входит в полную модель Repository Layer, но не обязан блокировать первый
вертикальный пилот, если `init`, `connect`, `status` и safe `sync` уже позволяют
воспроизводимо выполнять Change.

**Владение**

| Участник | Ответственность в Repository Layer |
|---|---|
| Core | Config parsing, repository identity, workspace, Git mechanics, status/sync и local observed state |
| OpenSpec | Store registration, Store context и собственная диагностика OpenSpec |
| Template | Начальные project assets и agent mapping во время `init` |
| Пользователь | Состав repositories, ручное разрешение конфликтов и подтверждение warnings |

**Что не входит в слой**

- определение того, какие repositories затрагивает конкретный Change;
- чтение Design или Tasks;
- построение implementation plan;
- Result Receipts и composite verification;
- автоматический Repository Graph/discovery в v1;
- фоновое обновление checkouts без явной команды.

Текущие `init` и `connect` относятся к этому слою и являются основой, а не выбрасываемым
прототипом. Однако слой не считается завершённым без общего repository status,
предсказуемого повторного подключения и безопасной реакции на изменение config.

#### 3.3.4. Change Layer

**Назначение**

Change Layer связывает один принятый OpenSpec Change с точным Planning Baseline и
подтверждённым списком участвующих repositories. Он является уровнем координации всего
multi-repository изменения и отвечает на вопросы:

- какой Change сейчас рассматривается;
- какая принятая Git revision Store является его Baseline;
- какие repositories входят в принятый Change Binding;
- какие Assignment identities следуют из Binding;
- каков общий статус реализации и проверки Change;
- какие данные missing, failed или stale и почему следующий orchestration gate не
  считается пройденным.

**Главная пользовательская ценность**

Инженер передаёт явный `change-id` и получает одну согласованную картину по всем
repositories, не выбирая Baseline и не перенося внутренние planning IDs вручную.

**Канонические объекты**

- **Change Reference** — идентичность Change, которой владеет OpenSpec.
- **Accepted Baseline** — точная принятая revision Store, на которой согласованы
  planning-артефакты.
- **Change Binding** — минимальная связь Change со списком repository IDs.
- **Assignment Identity** — производная идентичность
  `Change + Baseline + Repository`; максимум одна на repository.
- **Aggregate Status** — вычисленное представление состояния всех Assignments,
  Result Receipts и последней composite verification.

Change Binding не является Execution Plan. Он не хранит Tasks, цели, порядок работы,
Acceptance Criteria или копию Design. Если состав repositories изменился, должны быть
обновлены planning-артефакты, проведено новое согласование и принят новый Baseline.
Существующие Assignments не переключаются на него молча.

**Входы**

- явный `change-id` в каждой Change-layer operation;
- OpenSpec Change и его доступные planning-артефакты;
- принятый Planning Baseline;
- Change Binding;
- repository registry;
- Result Receipts и gate results из local state.

**Выходы**

- разрешённый и явно показанный Baseline;
- набор Assignment identities;
- общий `status(change-id)`;
- причины `missing`, `failed` и `stale`;
- точные данные, необходимые для перехода к Implementation Layer;
- Change-level Snapshot и результат composite verification после реализации.

**Целевой lifecycle**

```text
plan through OpenSpec/Template
    → accept Change Binding and Baseline
    → derive Assignments
    → aggregate status
    → composite verify exact Snapshot
```

Содержательное планирование выполняют OpenSpec, Template, агент и человек. Core не
делает альтернативный planning engine. Его работа начинается там, где появился
принятый результат планирования, который можно связать с точной revision.

`status(change-id)` всегда показывает весь Change. Текущий repository только
выделяется визуально и получает `is_current: true` в JSON. Неявное ограничение status
текущим checkout запрещено; для локального представления нужен явный repository filter.

**Baseline rules**

- обычная команда сама разрешает принятый Baseline;
- использованный Baseline всегда присутствует в human и JSON output;
- `expected-baseline` является только assertion для автоматизации;
- несовпадение assertion является error;
- новый принятый Baseline не изменяет существующий Assignment автоматически;
- устаревшие Receipts и verification results помечаются `stale`, а не используются
  как доказательство новой revision.

**Владение**

| Участник | Ответственность в Change Layer |
|---|---|
| OpenSpec | Change identity, Schema, planning artifacts, validation и Archive |
| Core | Baseline resolution, Change Binding coordination, Assignment identities, aggregate status и orchestration gates |
| Template | Способ планирования, команды/skills команды и чтение произвольных planning-артефактов |
| Пользователь/владельцы | Подтверждение Binding, planning approval и решение изменить Scope |

**Что не входит в слой**

- интерпретация бизнесового смысла Change;
- обязательное наличие `proposal.md`, `design.md`, `tasks.md` или конкретной Schema;
- генерация локального implementation plan;
- управление порядком написания кода;
- блокирование штатного OpenSpec Archive;
- автоматическое добавление найденного repository без нового согласования.

Если пользователь архивирует Change в обход orchestration gates, Core только
сообщает состояние последней проверки. Он не присваивает себе владение Archive.

Текущая команда `change` является только частичной основой этого слоя: она работает с
OpenSpec Change, но пока не создаёт Change Binding, не разрешает принятый Baseline, не
выводит Assignments и не даёт aggregate `status(change-id)`.

#### 3.3.5. Assignment/Implementation Layer

**Каноническое имя**

Используется термин **Assignment/Implementation Layer**. Короткое имя в обсуждении —
Implementation Layer. Термин `Application Layer` или «слой применения» не используется,
потому что его легко спутать с OpenSpec Apply и с архитектурным application layer
прикладного кода.

**Назначение**

Слой отвечает за выполнение части Change в одном конкретном repository. Он связывает
принятый общий план с локальной работой, но не дублирует содержательный план внутри
Core. Он отвечает на вопросы:

- какое Assignment соответствует текущему repository;
- на каком Change и Baseline оно основано;
- какие точные Store и code revisions должен видеть исполнитель;
- какой Template handoff нужно использовать;
- какой минимальный структурированный результат вернулся после реализации;
- можно ли считать этот результат актуальным для composite verification.

**Главная пользовательская ценность**

После перехода в repository инженер вызывает операцию с одним `change-id`. Core сам
определяет Assignment и готовит точный контекст. Пользователь не переносит Work Package
IDs, пути planning-артефактов, Store ID или Baseline между командами и сессиями.

**Канонические объекты**

- **Assignment** — техническая координационная единица
  `Change + Baseline + Repository`.
- **Implementation Context** — неизменяемые runtime facts, сформированные Core для
  конкретного вызова.
- **Handoff** — структурированная передача Implementation Context в agent-facing
  command/skill из Template.
- **Result Receipt** — небольшой versioned schema-neutral результат Assignment.
- **Evidence** — ссылка или утверждение о выполненной проверке с честно указанным
  источником; отчёт агента не маскируется под проверку, повторно исполненную Core.

**Входы**

- явный `change-id`;
- разрешённые Change, Baseline и Change Binding;
- текущий или явно переданный repository ID;
- точные Store и repository revisions;
- общий пользовательский `context` из актуального `openspec-orch.yaml`;
- Template handoff mapping;
- доступные OpenSpec planning-артефакты без предположений об их именах.

**Implementation Context содержит только технические факты**

- Change ID;
- Baseline;
- Store identity и revision;
- repository identity, root и revision;
- Assignment identity;
- разрешённые roots и security boundaries;
- ссылки на доступный OpenSpec context;
- config digest/revision;
- путь или идентификатор выбранного Template handoff.

Общий текстовый `context` дополняет запрос агенту, но не может переопределить Change,
Baseline, repository identity, revisions и security boundaries. Config перечитывается
при каждом новом agent-facing вызове, поэтому пользователь может редактировать context
между операциями без повторного `init` или `connect`.

**Целевой lifecycle одного Assignment**

```text
resolve Assignment
    → build Implementation Context
    → invoke Template handoff
    → agent/human implements outside Core
    → record Result Receipt
    → validate receipt consistency
    → include exact revision in composite verification Snapshot
```

Один Assignment может проходить несколько внутренних итераций реализации. Core не
обязан хранить каждую мысль агента или промежуточный локальный task list. Значимым
результатом для orchestration является последний валидный Result Receipt, связанный с
точной revision.

**Минимальный Result Receipt**

Точный JSON/Zod contract определяется implementation plan, но он должен оставаться
маленьким и включать как минимум:

- contract version;
- Change ID, Baseline, repository ID и Assignment ID;
- реализованную repository revision;
- result status;
- источник результата;
- заявленные checks/evidence без ложного утверждения, что Core их перезапустил;
- время или другую техническую metadata, необходимую для диагностики актуальности.

Core выполняет structural validation и consistency checks по доступным Git/OpenSpec
фактам. Project-specific test suite, lint, manual QA и бизнесовые acceptance checks
выполняются Template, агентом, человеком, CI или будущим Plugin и только честно
отражаются в Receipt.

**Composite verification**

Публичная операция `verify(change-id)` является Change-level entrypoint, потому что
проверяет весь Change, но собирает результаты Assignment/Implementation Layer. Core:

1. разрешает точный Snapshot участвующих revisions;
2. проверяет наличие и актуальность всех необходимых Result Receipts;
3. проверяет универсальные зависимости и orchestration gates;
4. передаёт Snapshot внешней project-specific проверке через Template/агента/человека;
5. принимает простой результат `pass|fail`, источник и тот же Snapshot.

Core не создаёт отдельный сложный verification workflow и не заявляет, что выполнил
проверки, которые фактически выполнил другой участник.

**Владение**

| Участник | Ответственность в Assignment/Implementation Layer |
|---|---|
| Core | Assignment identity, Implementation Context, handoff safety, Receipt schema/consistency, local state и Snapshot |
| OpenSpec | Нормативный Change и доступ к его schema-defined planning context |
| Template | Способ реализации, agent commands/skills и project-specific verification |
| Агент/человек | Локальный implementation plan, изменение кода и честная фиксация результата |
| Plugin, позже | Только явно выбранная внешняя executable capability, например чтение CI/PR status |

**Что не входит в слой**

- собственная интерпретация Core произвольного плана;
- обязательные Work Package IDs;
- предположение о наличии Tasks в Schema;
- кеширование содержательного implementation plan;
- скрытый выбор последнего Change;
- автоматические внешние writes;
- серверная синхронизация Receipts в local-first v1.

Текущая команда `load` является опытом и частичным прототипом этого слоя, но её
ручные `store/repo/baseline/work-package` параметры не являются целевым API. Новый
контракт должен выводить эти технические данные из `change-id`, Binding, Baseline и
текущего repository, останавливаясь при неоднозначности.

#### 3.3.6. Сквозные инварианты трёх слоёв

1. **Явная identity.** Каждая Change-layer и implementation operation получает
   `change-id`; история предыдущего CLI-вызова не выбирает Change.
2. **Schema neutrality.** Core не ветвится по имени Schema и не требует фиксированных
   planning filenames.
3. **Accepted scope.** Обнаруженное состояние не становится принятым Binding без
   подтверждения и нового planning Baseline.
4. **Exact revisions.** Baseline, repository revisions и config digest всегда
   присутствуют в машинном результате операции.
5. **No silent rebind.** Изменение config, Binding или Baseline не переносит старый
   Assignment/Receipt на новое состояние.
6. **Warning is a choice.** Warning требует явного `continue|cancel`, default — cancel;
   non-interactive вызов сначала возвращает `needs_confirmation` без side effects.
7. **Error is final for the call.** Error нельзя обойти подтверждением.
8. **Desired и observed state разделены.** `openspec-orch.yaml` принадлежит
   пользователю; `.openspec-orch/state.json` принадлежит Core и восстанавливается
   настолько, насколько позволяют Git/OpenSpec facts.
9. **Template remains declarative.** Template не получает скрытые executable hooks.
10. **Core owns only Core gates.** Нарушение orchestration gate диагностируется, но
    Core не блокирует OpenSpec Archive и не забирает ответственность пользователя.
11. **Local-first v1.** Состояние одного инженера не выдаётся за общий командный state.
12. **Extensions by observed trigger.** Graph, Plugin runtime, Template composition,
    team receipt transport и Control Plane не попадают в v1 заранее.

`explore`, `plan` и `verify` не образуют дополнительные orchestration layers. Это
операции или handoffs, которые используют объекты одного или нескольких канонических
слоёв. Например, `verify(change-id)` является Change-level entrypoint и агрегирует
Result Receipts из Assignment/Implementation Layer.

#### 3.3.7. Критерий завершённости каждого слоя

| Слой | Минимальное доказательство готовности |
|---|---|
| Repository | Из чистого окружения можно выполнить `init/connect`, повторно проверить workspace и безопасно объяснить или устранить repository drift без ручной пересборки окружения |
| Change | По одному `change-id` Core разрешает принятый Baseline и Binding, создаёт по одному Assignment на repository и показывает полный aggregate status |
| Assignment/Implementation | В каждом repository по одному `change-id` формируется точный context, вызывается Template handoff, сохраняется валидный Receipt, а весь Change проверяется на одном Snapshot |

Автоматические unit/integration tests необходимы, но не заменяют вертикальный пилот на
двух или трёх реальных repositories с кастомной OpenSpec Schema и пользовательским
Template. Только такой пилот подтверждает, что три слоя соединяются в один продукт,
а не существуют как независимые наборы команд.

## 4. Чем продукт не должен становиться

Orchestrator не должен автоматически превращаться в:

- замену OpenSpec;
- собственный формат Specs и Changes;
- ещё один task tracker;
- универсальную CI/CD-систему;
- Git hosting platform;
- монорепозиторный build system;
- обязательный агентский фреймворк;
- жёстко заданный SDD-процесс одной команды;
- marketplace недоверенного исполняемого кода без модели безопасности;
- систему, которая сама принимает архитектурные решения по статистически найденным зависимостям;
- команду `exec --all`, бесконтрольно выполняющую произвольные действия во всех репозиториях.

Ценность продукта должна возникать из координации уже существующих систем, а не из попытки заново реализовать каждую из них.

## 5. Главные принципы

### 5.1. OpenSpec остаётся владельцем Change

**Принцип:** OpenSpec владеет:

- Specs;
- Changes;
- schemas;
- artifact graph;
- status артефактов;
- instructions для артефактов;
- валидацией OpenSpec-состояния;
- штатными операциями sync и archive.

Orchestrator использует публичный контракт OpenSpec и не должен копировать его внутреннюю логику.

### 5.2. Core не знает семантику конкретной схемы

**Принцип:** Core не должен содержать условия вида:

```text
if schema == "spec-driven"
if artifact == "proposal"
if outputPath == "tasks.md"
```

Для Core имя schema, идентификатор artifact и его путь должны быть непрозрачными значениями, полученными от OpenSpec.

Core вправе проверять технический контракт:

- ответ относится к ожидаемому Store и Change;
- путь безопасен и находится внутри разрешённого root;
- artifact существует в ответе OpenSpec;
- status имеет поддерживаемую структурированную форму;
- переданная revision однозначна;
- Snapshot воспроизводим.

Но Core не должен решать, зачем команде Proposal, Design или Tasks.

### 5.3. Repository Graph и Artifact Graph — разные модели

**Принцип:** нельзя объединять два графа под одним неразличимым термином.

- **OpenSpec Artifact Graph** описывает зависимости между артефактами одного Change.
- **Repository Graph** описывает технические отношения между репозиториями проекта.

Artifact Graph отвечает на вопрос: «Какой артефакт Change можно создавать следующим?»

Repository Graph отвечает на вопрос: «Какие репозитории и связи могут быть затронуты этой работой?»

Связь между графами возникает через Scope, Snapshot, Handoff и Evidence, но один граф не должен становиться хранилищем другого.

### 5.4. Процесс команды принадлежит Template

**Принцип:** конкретный процесс команды не зашивается в Core.

Project Template может определять:

- agent mapping;
- project instructions;
- commands;
- skills;
- subagents;
- methodology bundles;
- OpenSpec config и project-local schemas;
- правила планирования и реализации;
- human approvals;
- способы использования Core capabilities и Plugins;
- формат Handoff, который понимает конкретный агентский процесс.

### 5.5. Исполняемая интеграция не маскируется под Template

**Принцип:** Template — декларативный набор project assets и правил. Если расширение должно обращаться к сети, Jira, GitHub, Bitbucket, CI, service catalog или выполнять сложное обнаружение зависимостей, это Plugin или внешняя система, а не скрытый hook Template.

### 5.6. Обнаруженное не равно принятому

**Принцип:** автоматически найденная связь между репозиториями не становится архитектурным фактом без evidence и принятия.

Orchestrator должен различать:

- объявленную и принятую связь;
- обнаруженного кандидата;
- связь, подтверждённую только для конкретного Change;
- устаревшую или конфликтующую связь.

### 5.7. Воспроизводимость важнее «последнего состояния»

**Принцип:** handoff «используй текущие ветки» недостаточен для серьёзной multi-repo работы. Для проверки и передачи контекста нужны точные revisions каждого участвующего репозитория.

### 5.8. Orchestrator config является живой конфигурацией

**Принцип:** `openspec-orch.yaml` — один user-owned declarative desired state, который
читается заново для каждой операции так же, как актуальная project configuration
OpenSpec. Пользователь может редактировать все поддерживаемые поля. `init` только
создаёт стартовое состояние, а `connect` материализует и проверяет machine-local
workspace, сохраняя observed state отдельно. Core сам сравнивает desired и observed
state и объясняет последствия изменения. Уже запущенная операция продолжает
использовать снимок config, прочитанный в её начале.

## 6. Концептуальная карта слоёв

```text
┌──────────────────────────────────────────────────────────────┐
│                    Team / Product Process                    │
│ Project Template · commands · skills · methodology bundles  │
└──────────────────────────────┬───────────────────────────────┘
                               │ uses capabilities
┌──────────────────────────────▼───────────────────────────────┐
│                    OpenSpec Orchestrator Core                │
│ Store context · Binding · Scope · Snapshot · Handoff        │
│ workspace · repository operations · technical contracts     │
└───────────────┬──────────────────────────────┬───────────────┘
                │ public CLI/API               │ explicit protocol
┌───────────────▼────────────────┐  ┌──────────▼───────────────┐
│            OpenSpec            │  │ Orchestrator Plugins     │
│ Store · Specs · Changes        │  │ Git · CI · tracker       │
│ schemas · Artifact Graph       │  │ discovery · evidence     │
└────────────────────────────────┘  └──────────────────────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                  Git repositories and services
```

Важно: Template использует capabilities Core и OpenSpec, но не меняет их внутреннюю реализацию. Plugin расширяет исполняемые возможности, но не получает неявного права вмешиваться во все lifecycle-команды.

### 6.1. Принципы публичного API

API группируется по слоям ответственности. Операции одного слоя используют общий
явный набор identities, поэтому одинаковый вызов не меняет смысл из-за ранее
выполненной команды.

Для Change-layer действует минимальное правило:

```text
status(change-id)
implement(change-id, ...)
record(change-id, ...)
verify(change-id, ...)
```

В Core нет скрытого active/current Change. Значения, которые можно однозначно и
безопасно получить из текущего Store Context, repository checkout или принятого
Binding, могут вычисляться Core, но вычисленный результат всегда показывается в
выводе. Если значение неоднозначно, команда завершается диагностикой и требует
явный параметр вместо выбора по эвристике.

Baseline обычной Change-layer команды вычисляется из принятой planning revision, а
не из текущего Store `HEAD`. Он фиксируется в начале операции и попадает в output,
Assignment, Result Receipt и Snapshot. Новый принятый Baseline не переносит на себя
существующую работу автоматически. Для automation допускается assertion
`expected-baseline`, которое проверяет ожидание вызывающей стороны, но не служит
ручным переключателем на произвольную revision.

`status(change-id)` является Change-level представлением и всегда включает все
repositories из Binding. В интерактивном выводе текущий repository можно выделить
цветом или жирным начертанием с доступным текстовым fallback. В JSON визуальных
соглашений нет: текущий repository обозначается полем `is_current`. Фильтрация до
одного repository выполняется только явным параметром.

## 7. Предлагаемая доменная модель

### 7.1. Store Context и отложенный Project

Для первой версии верхней границей оркестрации является один OpenSpec Store. Его
версионируемая конфигурация связывает:

- Store identity;
- Repository References;
- Change Bindings;
- выбранный Project Template и agent mapping;
- общие правила доверия и безопасности, необходимые local-first Core.

Локальный workspace материализует этот Store Context на конкретной машине, но
machine-local paths не становятся частью общей Git-tracked конфигурации.

Отдельная сущность Project сознательно отложена. Она вводится только если появится
хотя бы один подтверждённый сценарий:

- одна orchestration boundary объединяет несколько Stores;
- одному Store нужны несколько независимых наборов repositories или policies;
- Store перестаёт быть достаточной стабильной identity для командного использования.

### 7.2. Store

Store — OpenSpec-owned репозиторий или root, содержащий нормативные Specs и Changes.

Store не должен автоматически становиться владельцем:

- всего workspace;
- глобального списка проектов пользователя;
- локального расположения checkout;
- графа всех технических зависимостей организации;
- credentials внешних систем.

В v1 Store одновременно является источником OpenSpec-состояния и orchestration root,
но не владеет локальными checkout, credentials или глобальным пользовательским
каталогом. Один Code Repository может участвовать в нескольких Store Contexts через
разные workspaces или явный выбор Store без постоянного однозначного repo pointer.

### 7.3. Repository Reference

Repository Reference — стабильная запись о репозитории в границах Store Context:

- `repository_id`;
- canonical remote identity;
- default branch;
- optional local checkout;
- labels или capabilities без жёстких ролей `frontend/backend` в Core;
- metadata source;
- trust или ownership metadata, если это действительно требуется.

Core должен работать с универсальными репозиториями. Доменные роли команды могут задаваться Template, каталогом сервисов или Plugin.

### 7.4. Repository Graph

Repository Graph — принятая модель отношений между Repository References.

Минимальная форма ребра:

```yaml
source: frontend
target: public-api
kind: api-consumes
origin: declared
evidence:
  type: file
  repository: frontend
  revision: <sha>
  path: src/api/client.ts
status: accepted
```

Точный формат не принят. Значимы сами свойства:

- направление;
- тип связи;
- происхождение;
- evidence;
- revision, на которой evidence наблюдался;
- статус принятия;
- при необходимости confidence и срок актуальности.

### 7.5. Scope

Scope — выбранный для конкретной операции набор Repository References или, после
появления графа, подграф orchestration boundary.

Scope может быть:

- явным: пользователь выбрал репозитории;
- вычисленным: все принятые dependants заданного репозитория;
- предложенным: результат discovery;
- смешанным: явный seed плюс подтверждённые affected repositories.

Scope должен сохранять объяснение выбора:

- какие seed repositories были указаны;
- какие узлы добавлены обходом графа;
- по каким рёбрам;
- какие кандидаты исключены;
- какие ограничения глубины или типов связей применялись.

### 7.6. Snapshot

Snapshot — воспроизводимая фиксация Scope в конкретный момент.

Он должен включать как минимум:

- Store Context identity;
- Scope identity или его полное описание;
- Store identity и revision;
- точную revision каждого выбранного Code Repository;
- релевантные graph edges и их evidence revision;
- состояние dirty/clean или иной показатель воспроизводимости;
- время создания и создателя/источник;
- причину создания;
- при необходимости OpenSpec Change identity и schema.

Snapshot не обязательно должен быть отдельным долговечным файлом в каждом репозитории. Необходимо сначала определить его lifecycle и владельца.

### 7.7. Handoff

Handoff — проверенный пакет входных данных для следующего исполнителя или стадии.

Получателем может быть:

- AI-агент;
- человек;
- другая команда;
- CI job;
- Plugin;
- implementation session в отдельном репозитории.

Handoff не должен состоять только из длинного prompt. Желательно иметь структурированную основу:

- операция и intent;
- Store и Change;
- Scope;
- Snapshot;
- разрешённые roots;
- OpenSpec artifact/instructions;
- выбранный Template entrypoint;
- обязательные gates;
- уже собранное Evidence;
- ожидаемый структурированный результат.

Template может поверх этой основы формировать конкретную команду или agent prompt.

### 7.8. Evidence

Evidence — проверяемое утверждение о факте, важном для продолжения работы.

Примеры:

- файл на точной revision содержит контракт;
- CI job прошла для конкретного commit;
- PR merged;
- Change validation завершилась без ошибок;
- набор revisions прошёл composite verification;
- человек с нужной ролью подтвердил решение;
- dependency edge подтверждён service catalog или manifest.

Evidence должно содержать источник и объект проверки. Текст «тесты прошли» без команды, revision и результата не является достаточным техническим Evidence.

### 7.9. Gate

Gate — условие, блокирующее переход к следующему состоянию процесса.

Gate действует только внутри слоя, который владеет соответствующим переходом. Gate
Core может не позволить Orchestrator считать Snapshot проверенным, но не получает из
этого права запрещать OpenSpec Archive. Если действие в другом слое выполнено в
обход gate, Core сообщает о рассинхронизации и сохраняет честное состояние своего
lifecycle.

Gate не является одним механизмом. В модели необходимо различать:

| Тип | Пример | Основной владелец |
|---|---|---|
| Artifact gate | Design зависит от принятого Proposal | OpenSpec Schema |
| Process gate | Change Owner подтверждает scope | Project Template |
| Technical gate | Контрактные тесты прошли на Snapshot | Core или Plugin |
| External governance gate | PR approved или ticket имеет нужный статус | Plugin/external system |

Schema может требовать Evidence или отдельный verification artifact, но не должна притворяться, что сама выполнила CI, проверила Git provider или получила человеческое согласование.

### 7.10. Assignment

Assignment — техническая координационная идентичность одной работы конкретного
repository в рамках принятого Change и Baseline:

```text
Assignment = Change + Baseline + Repository
```

Для первой версии действует кардинальность:

```text
Change 1 ── 0..1 Assignment ── 1 Repository
```

Один Change может содержать много Assignments, но не более одного для одного
repository. Assignment не копирует Tasks, Work Packages, локальные этапы или другие
schema-specific единицы. Их содержание и порядок остаются в принятом планировании и
интерпретируются Template и агентом при подготовке локальной реализации.

Core координирует только внешний lifecycle Assignment:

```text
planned → ready → implementing → result-recorded → verified
```

Локальный implementation flow внутри `implementing` принадлежит Template и агенту.
Невыполненная зависимость другого Assignment не запрещает переход в `implementing`,
но может блокировать `verified`, если без связанного Result Receipt или Evidence
невозможно подтвердить совместимость.

### 7.11. Change Binding

Change Binding — минимальная принятая связь Change со списком участвующих Repository
References:

```yaml
change: pay-412-payment-status
repositories:
  - payment-api
  - web-checkout
  - notification-worker
```

Binding входит в Planning Baseline и отвечает только на два вопроса:

- относится ли repository к Change;
- должен ли для него существовать один Assignment.

Binding не содержит содержательного задания, Tasks, Work Packages, порядка
реализации или локального implementation plan. Эти сведения остаются в произвольных
OpenSpec planning-артефактах и разрешаются Template/агентом just-in-time.

Binding формируется в несколько шагов:

```text
user seed repositories
        ↓
planning-agent proposals with evidence
        ↓
explicit user confirmation
        ↓
Planning PR and accepted Baseline
```

Planning-agent не изменяет Binding молча. После принятия Baseline дополнительный
repository означает изменение Planning Scope и требует повторного согласования.

### 7.12. Result Receipt

Result Receipt — небольшой структурированный результат одного Assignment. Он
содержит техническую идентичность работы, итоговую repository revision, заявленные
checks и deviations, но не копирует локальный implementation plan или историю агента.

Минимальный концептуальный контракт:

```yaml
version: 1
change: pay-412-payment-status
baseline: <store-sha>
repository: web-checkout
revision: <repository-sha>
status: ready-for-verification
checks:
  - command: npm test
    exit_code: 0
    reported_by: agent
deviations: []
```

Core выполняет два ограниченных уровня проверки:

1. runtime schema validation: обязательные поля, типы, enums, version и отсутствие
   внутренних противоречий;
2. consistency validation: Change, Baseline, Change Binding, repository identity и
   существование revision через публичные Git/OpenSpec capabilities.

Поле `reported_by: agent|human` является аттестацией источника, а не доказательством,
что Core независимо повторил project-specific command. Независимое CI Evidence
откладывается до будущего Plugin.

В первой версии Receipt хранится локально до composite verification. Structural
ошибку можно исправить или перегенерировать; failed/stale Evidence нельзя превратить
в passed простой правкой документа — требуется новая проверка на актуальной revision.

## 8. OpenSpec Schema и граница кастомизации

### 8.1. Что должна определять Schema

Schema логично использовать для:

- состава артефактов Change;
- зависимостей между артефактами;
- правил готовности артефактов;
- templates и instructions артефактов;
- обязательного структурированного Evidence, если OpenSpec-модель это поддерживает;
- различий между типами Change.

Например, одна команда может использовать простой flow:

```text
intent → specification → implementation-plan
```

Другая:

```text
proposal → impact → security-review → design → tasks → verification
```

Core не должен меняться из-за различия этих графов.

### 8.2. Что не следует переносить в Schema

Schema не должна становиться местом реализации:

- Git fetch/clone/sync;
- вычисления affected repositories;
- чтения CI API;
- изменения ticket;
- автоматического merge;
- установки skills;
- управления credentials;
- provider-specific запуска агента;
- универсальной логики workspace.

### 8.3. Критерий schema-neutral Core

Архитектурный тест:

> Можно установить новую корректную OpenSpec Schema с другими именами и порядком артефактов, после чего Core продолжит выполнять свои операции без изменения production-кода.

Если для новой схемы требуется иной командный процесс, меняется Template. Если требуется новый внешний executable capability, добавляется Plugin. Но Core не получает новое условие по имени schema.

## 9. Project Template, skills и команды

### 9.1. Назначение Template

Project Template должен быть способом собрать agent-facing и team-specific слой проекта:

- инструкции;
- commands;
- skills;
- subagents;
- OpenSpec config и schemas;
- handoff mappings;
- conventions;
- ссылки на Plugin capabilities;
- правила командной работы.

Template не является исполняемым расширением Core. Он может установить agent command
или skill, который затем выполняет сам agent runtime, но не предоставляет Core
скрытые lifecycle hooks, JavaScript/Python callbacks или shell scripts для запуска
во время Core-команд.

### 9.2. Пользователь не обязан использовать `/opsx-*` как основной UX

Команда может использовать:

- штатные `/opsx-*`;
- собственные `/team-*` команды;
- Superpowers или другой methodology bundle;
- skills Matt Pocock;
- свои узкоспециализированные skills;
- смешанный процесс.

Кастомная команда может использовать публичный CLI/API OpenSpec напрямую. Она не обязана вызывать slash-wrapper `/opsx-*`, если получает тот же корректный OpenSpec status, instructions и validation.

При этом встроенные assets OpenSpec не следует модифицировать. Их можно оставить доступными и не использовать как основной entrypoint.

### 9.3. Methodology Bundle

Полезно отделить **Methodology Bundle** от полного Project Template.

Methodology Bundle — переносимый набор поведения агента:

- brainstorming;
- planning;
- debugging;
- TDD;
- code review;
- documentation workflow;
- project management skills.

Он не обязан знать Store Context или Repository Graph. Template подключает bundle и связывает его с конкретным процессом команды.

### 9.4. Проблема композиции

Один монолитный Template плохо масштабируется, если команда хочет совместить:

- базовый OpenSpec adapter;
- корпоративные инструкции;
- Superpowers;
- Matt Pocock skills;
- security pack;
- локальные команды проекта.

**Рабочая гипотеза:** в будущем нужен Template Recipe или Composer, который собирает несколько источников в один проверенный Resolved Template Plan.

Возможные свойства источника:

```yaml
id: team-security-pack
version: 2.1.0
provides:
  - skill:security-review
requires:
  - capability:openspec.instructions
conflicts:
  - command:legacy-security-check
targets:
  - codex
  - qwen
source: <package-or-path>
trust: reviewed
```

Composer должен разрешать файловые коллизии до записи. Он не должен автоматически выполнять смысловой merge двух `AGENTS.md`, `QWEN.md` или других инструкций без явной стратегии.

**Открытые вопросы:**

- является ли Recipe частью Core или отдельным builder;
- как версионировать источники;
- как обновлять уже материализованный Template;
- как хранить provenance каждого файла;
- какие merge strategies допустимы;
- как проверять доверие к bundle;
- нужен ли registry или достаточно Git/npm/local sources.

## 10. Orchestrator Plugins

### 10.1. Зачем нужны Plugins

Plugins нужны для исполняемых возможностей, которые не относятся к универсальной механике Core:

- чтение Jira/SberTrack;
- GitHub/Bitbucket/GitLab PR status;
- CI evidence;
- service catalog;
- обнаружение зависимостей по package manager или API definitions;
- ownership systems;
- deployment state;
- внутренние корпоративные API.

### 10.2. Граница Plugin

Plugin должен:

- объявлять capabilities;
- вызываться явно;
- получать ограниченный structured input;
- возвращать structured output;
- иметь понятный trust level;
- отделять read-only операции от writes;
- поддерживать idempotency для разрешённых writes;
- оставлять audit evidence.

Plugin не должен:

- молча подключаться к каждой Core-команде;
- изменять OpenSpec internals;
- редактировать Schema без явной команды пользователя;
- получать весь workspace, если ему нужен один manifest;
- автоматически принимать найденные graph edges;
- выполнять external writes только потому, что Template упомянул capability.

### 10.3. Plugin и Template

Core предоставляет capability protocol. Plugin реализует capability. Template определяет, когда процесс команды просит её использовать.

Пример:

```text
Template gate: перед verification требуется ci.result
        ↓
Core вызывает явно выбранный Plugin capability
        ↓
Plugin получает repository + revision
        ↓
Plugin возвращает Evidence
        ↓
Template/OpenSpec workflow решает, можно ли продолжать
```

## 11. Repository Graph — отложенное исследование

Этот раздел сохраняет результаты брейншторма, но не описывает backlog или Core v1.
К нему следует возвращаться только при подтверждённой проблеме неизвестного Scope.

### 11.1. Что должен давать граф

Repository Graph должен позволять ответить:

- какие репозитории непосредственно связаны с выбранным репозиторием;
- какие могут быть затронуты изменением контракта;
- почему репозиторий попал в Scope;
- по какой цепочке проходит зависимость;
- какие связи объявлены, а какие только обнаружены;
- на какой revision связь была подтверждена;
- какие checkout нужны для операции;
- какой минимальный набор репозиториев следует передать агенту;
- какой набор revisions необходимо проверить совместно.

### 11.2. Три представления графа

**Рабочая гипотеза:** нужны три связанных, но разных представления.

#### Accepted Repository Graph

Версионируемая принятая топология orchestration boundary. Используется как основной источник для обхода и `affected`.

#### Discovered Candidate Graph

Набор автоматически найденных кандидатов с evidence, revision и confidence. Не влияет на обязательный Scope без принятия или явного режима.

#### Change Scope Graph

Подграф, выбранный для конкретного Change или операции. Может включать принятые рёбра и явно подтверждённых кандидатов. Фиксируется в Snapshot.

### 11.3. Типы связей

Core должен поддерживать namespaced edge kinds и не пытаться понимать каждый доменный тип.

Примеры для обсуждения:

- `generic:depends-on`;
- `api:consumes`;
- `package:imports`;
- `events:subscribes-to`;
- `deployment:deployed-with`;
- `infra:provisions`;
- `ownership:owned-by`.

Не все отношения являются зависимостями. Например, `owned-by` полезно для routing, но не должно автоматически расширять technical affected Scope.

Для каждого вида обхода нужна policy:

- направление;
- максимальная глубина;
- какие kinds учитываются;
- должен ли найденный узел подключаться автоматически;
- является ли связь blocking или informational.

### 11.4. Источники графа

Возможные источники:

- ручная декларация Store Context или будущего Project;
- package manifests;
- lockfiles;
- OpenAPI/AsyncAPI/GraphQL contracts;
- code imports;
- CI configuration;
- deployment manifests;
- service catalog;
- ownership metadata;
- Plugin корпоративной платформы;
- evidence, подтверждённое во время Explore.

Необходимо отдельно оценить стоимость и достоверность каждого источника. Универсальный глубокий static analysis всех языков не должен быть обязательным условием Core v1.

### 11.5. Обновление графа

Открытые варианты:

1. Граф хранится декларативно рядом с orchestration root и меняется через review.
2. Граф хранится во внешнем service catalog, а orchestration root содержит только ссылку и cache.
3. Core хранит accepted graph, а Plugins поставляют candidates.
4. Snapshot сохраняет только использованный подграф и evidence.

Отложенная рабочая гипотеза: accepted graph принадлежит orchestration boundary,
discovery формирует кандидатов, а Snapshot фиксирует фактически использованный
подграф. Это не является частью v1.

## 12. Универсальные Core capabilities

Названия команд пока не должны считаться финальными. Важнее определить capabilities.

### 12.1. Store Context capabilities

- создать или подключить Store Context;
- проверить его Orchestrator-конфигурацию;
- показать выбранные Template и agent mapping;
- определить Store из его checkout или явного workspace context;
- поддержать участие одного Code Repository в нескольких Store Contexts без
  конфликтующего обязательного pointer.

### 12.2. Repository capabilities

- перечислить repositories;
- показать connected/missing/dirty/diverged состояние;
- подключить выбранные repositories;
- безопасно синхронизировать выбранные repositories;
- проверить canonical remote и default branch;
- получить точную revision;
- не выполнять destructive checkout, merge или rebase без отдельного явного сценария.

### 12.3. Graph capabilities

- показать граф;
- проверить ссылки и edge kinds;
- показать путь между двумя repositories;
- вычислить affected scope;
- объяснить, почему узел включён;
- обнаружить candidate edges;
- принять или отклонить candidates через reviewable изменение;
- сравнить graph revisions.

### 12.4. Scope и Snapshot capabilities

- создать Scope из явного списка;
- расширить Scope через graph policy;
- создать Snapshot;
- проверить доступность revisions;
- сравнить Snapshots;
- восстановить workspace из Snapshot, если это безопасно и поддерживается;
- создать ограниченный agent context без загрузки всех репозиториев.

### 12.5. OpenSpec bridge capabilities

- разрешить Store identity;
- получить Change status;
- получить artifact graph;
- получить instructions выбранного artifact;
- валидировать Change;
- передать schema и artifact identifiers без интерпретации;
- связать Change со Scope и Snapshot на уровне Handoff/Evidence.

### 12.6. Handoff capabilities

- сформировать structured handoff;
- проверить его полноту и пути;
- выбрать Template entrypoint;
- передать allowed roots;
- сохранить provenance;
- принять structured result;
- не интерпретировать team-specific смысл ответа внутри Core.

### 12.7. Diagnostics

- read-only `doctor`;
- единый JSON-контракт;
- полный список проблем за запуск, где это безопасно;
- разделение ошибок конфигурации, внешней инфраструктуры, Git, OpenSpec, Template и Plugin;
- `warning` всегда предлагает явный выбор `continue|cancel`, а `error` завершает
  операцию без возможности продолжения;
- явный `needs_confirmation` без побочных эффектов для non-interactive вызова;
- подтверждение конкретного warning code вместо общего неограниченного `force`;
- объяснение следующего безопасного действия.

## 13. Возможный жизненный цикл

Это не обязательный набор команд, а пример того, как capabilities складываются в продукт.
Каноническая модель v1 определена в разделе 3.3. Упоминания Template Recipe,
Repository Graph, discovery и Plugins ниже сохраняются как иллюстрации возможного
будущего развития и не входят в текущий implementation scope без триггера из раздела 22.

### 13.1. Подготовка Store Context

1. Пользователь выбирает или создаёт OpenSpec Store.
2. Объявляет initial repositories.
3. Выбирает Template Recipe и agent adapter.
4. Core собирает Resolved Template Plan.
5. Preflight показывает все создаваемые файлы и конфликты.
6. После подтверждения Store Context материализуется.
7. Созданный `openspec-orch.yaml` становится редактируемой Store-конфигурацией, а не
   закрытым build artifact Template.

### 13.2. Повседневное подключение к работе

1. Core определяет Store Context и заново читает актуальный `openspec-orch.yaml`.
2. Сравнивает declarative desired state с Core-managed local observed state.
3. Показывает состояние Store и repositories и необходимое следующее действие.
4. Пользователь подключает только нужные checkout.
5. Изменения context и operation mappings не требуют повторного `connect`.
6. Изменение repository registry может потребовать `connect`, только если нужно
   материализовать новый checkout или обновить machine-local routing.
7. Graph позволяет подключить `affected`, а не все repositories.
8. Doctor объясняет, что отсутствует или устарело.

### 13.3. Исследование задачи

1. Пользователь задаёт intent и seed repositories.
2. Core строит предложенный Scope.
3. Пользователь видит объяснение graph traversal.
4. При необходимости Plugin discovery предлагает новые edges.
5. Пользователь подтверждает Scope.
6. Core создаёт Snapshot.
7. Template выбирает agent methodology и формирует Handoff.

### 13.4. Создание и планирование Change

1. OpenSpec создаёт Change по выбранной Schema.
2. Core получает schema и artifact graph как opaque data.
3. Template определяет, какой command/skill готовит очередной artifact.
4. OpenSpec instructions остаются нормативным контрактом artifact.
5. Пользователь задаёт исходные repositories для Change Binding.
6. Planning-agent может предложить изменения Binding с причиной и Evidence; итоговый
   список требует явного подтверждения пользователя.
7. Planning flow фиксирует минимальный Change Binding без копирования содержательных
   planning-артефактов.
8. Planning review принимает артефакты и Binding одной Store revision, которая
   становится Baseline.

### 13.5. Реализация

1. Core проверяет по Change Binding, что текущий repository входит в Planning Scope.
2. Для сочетания Change, Baseline и repository создаётся одна техническая Assignment
   identity.
3. Core формирует Implementation Context: точные Store/repository revisions, OpenSpec
   status и artifact graph как opaque data, allowed roots и Template entrypoint.
4. Template и агент читают произвольные planning-артефакты, добавляют Store и
   Repository Context и составляют актуальный локальный implementation plan.
5. Агент использует skills, выбранные Template, и сам разбирает внутренние Tasks и
   порядок их выполнения.
6. Локальная реализация и тесты остаются в Code Repository.
7. При завершении Assignment фиксируется точная repository revision и Result Receipt
   с Evidence и deviations, а не копия всей истории агента.
8. Неготовность связанного repository не блокирует начало работы автоматически;
   порядок и допустимая параллельность принадлежат принятому плану.

### 13.6. Composite verification

1. Core убеждается, что для каждого repository из Change Binding существует Result
   Receipt, относящийся к тому же Change и Baseline.
2. Из точных implementation revisions собирается единый Snapshot.
3. Template, агент или человек определяет и выполняет project-specific contract,
   integration, E2E и manual checks вне Core.
4. Core получает простой результат `pass|fail`, его источник и ссылку на тот же
   Snapshot. Отдельный составной контракт или новый planning-артефакт для этого в
   первой версии не вводится.
5. Assignment dependency считается выполненной для проверки только при наличии
   требуемого Result Receipt или Evidence связанного repository.
6. Schema/Template требует нужный verification artifact или approval.
7. Core сообщает готовность собственного lifecycle, но не блокирует OpenSpec Archive.
   Если Change архивирован при `missing`, `failed` или `stale` verification gate,
   status/doctor показывает предупреждение и точную причину рассинхронизации.

## 14. Основные пользовательские группы

### 14.1. Продуктовый инженер в multi-repo продукте — первый пользователь

Нуждается в быстром ответе:

- какие репозитории нужны для задачи;
- в каком они состоянии;
- что читать;
- какую часть Change реализовывать;
- какие проверки выполнить;
- что передать дальше.

Первая версия должна давать самостоятельную ценность одному инженеру на одной
рабочей машине. Она не требует общего серверного состояния команды. Состав
репозиториев Change в основном известен инженеру на этапе планирования; задача
Orchestrator — зафиксировать этот Planning Scope, связать его с Baseline и затем
без ручного переноса параметров выдавать Assignment каждому репозиторию.

### 14.2. Tech Lead или архитектор

Нуждается в:

- обозримой топологии проекта;
- объяснимом impact analysis;
- reviewable dependency changes;
- точных revisions;
- контроле межрепозиторных контрактов;
- возможности менять процесс без форка Core.

### 14.3. Change Owner или Product/Business Analyst

Нуждается в:

- едином нормативном Change;
- понятном статусе артефактов;
- связи требований с реализацией нескольких команд;
- evidence вместо устного «всё готово»;
- сохранении OpenSpec Schema, подходящей конкретному процессу.

### 14.4. Platform/Developer Experience Team

Нуждается в:

- универсальном Core;
- управляемых Templates и bundles;
- Plugin SDK;
- единых diagnostics;
- безопасном rollout;
- возможности поддержать разные команды и agent runtimes без копирования Core.

### 14.5. Автор Template или Plugin

Нуждается в:

- стабильных контрактах;
- contract test kit;
- ясной модели capabilities;
- версионировании;
- понятной trust boundary;
- отсутствии скрытых lifecycle hooks.

## 15. Ключевые продуктовые сценарии

### Сценарий A. Изменение API затрагивает три репозитория

Пользователь выбирает backend как seed. Граф показывает frontend и SDK как consumers. Core объясняет цепочки, создаёт Scope и Snapshot. OpenSpec Change планируется по командной Schema. Template использует выбранный planning skill. После реализации Plugin собирает CI evidence для точных revisions всех трёх repositories.

### Сценарий B. Пользователь хочет только исследовать один сервис

Store Context содержит сто repositories, но разработчик подключает один. Core не
требует clone остальных. Graph traversal отключён или ограничен глубиной zero.
Handoff разрешает чтение только Store и выбранного checkout.

### Сценарий C. Discovery нашёл новую зависимость

Plugin обнаружил import из общей библиотеки. Связь попадает в Candidate Graph с file/revision evidence. Пользователь может включить её только в текущий Scope либо предложить изменение Accepted Graph через review.

### Сценарий D. Одна команда использует Superpowers, другая свои skills

Обе команды используют один Core и OpenSpec. Их Templates подключают разные Methodology Bundles и разные agent entrypoints. Ни Core, ни Repository Graph не меняются.

### Сценарий E. Кастомная Schema не содержит Proposal или Tasks

OpenSpec возвращает другой artifact graph. Core продолжает работать с Change status и instructions. Template знает командный flow новой Schema. Package-level implementation доступна только если Schema/OpenSpec возвращает адресуемые единицы работы; иначе используется whole-change handoff.

### Сценарий F. Один repository участвует в двух Store Contexts

Один checkout не должен быть навсегда привязан ровно к одному Store через обязательный
repo-local pointer. Пользователь или workspace выбирает активный Store Context явно.
Локальный pointer может быть удобной оптимизацией для однозначного случая, но не
глобальной истиной.

### Сценарий G. CI зелёный, но проверялись другие revisions

Gate не считается выполненным. Evidence должна относиться к Snapshot или к доказуемо эквивалентному набору commits.

### Сценарий H. Template и methodology bundle создают один файл

Composer останавливает сборку до применения и показывает конфликт владельцев. Автоматический смысловой merge не выполняется без выбранной стратегии.

## 16. Негативные сценарии и защита от них

### 16.1. Магический `affected`

Система молча добавила десять repositories, но не объяснила почему. Это делает граф недоверенным. Любой вычисленный Scope должен быть объяснимым.

### 16.2. Устаревшее evidence

Dependency edge найден год назад на удалённом файле. Граф должен показывать revision и freshness; discovery должен уметь пометить связь stale, а не продолжать считать её абсолютной истиной.

### 16.3. Schema выполняет shell

Если Schema получает произвольные hooks, исчезает граница данных и исполняемого кода. Внешняя операция должна быть Plugin capability с trust и audit.

### 16.4. Template управляет Core lifecycle неявно

Скрытый файл вызывает Jira write при каждом `connect`. Это недопустимо. External write должен быть отдельной явной операцией.

### 16.5. Агент получил весь workspace

Из-за удобства в prompt переданы пути сотен repositories. Контекст становится шумным, а права чтения чрезмерными. Scope и allowed roots должны ограничивать доступ.

### 16.6. Snapshot содержит dirty checkout без явного статуса

Такой Snapshot нельзя считать воспроизводимым. Система должна либо отклонить его в strict policy, либо явно записать ограничения relaxed режима.

### 16.7. Repository Graph становится CMDB всей организации

Orchestrator не должен требовать построения идеальной корпоративной модели до первой
полезной операции. Будущий graph может начинаться с малого и расширяться через evidence.

## 17. Trust, безопасность и изменения состояния

Необходимо заранее разделить:

- read-only inspection;
- локальные воспроизводимые writes;
- Git writes;
- external system writes;
- destructive operations.

Базовые требования:

- все пути проверяются до чтения и записи;
- symlink и выход за allowed root блокируются;
- credentials не сохраняются в Store Orchestrator config и Snapshot;
- команды показывают план materialization до изменения файлов;
- external writes требуют явного вызова и идемпотентного контракта;
- Plugin получает минимальные полномочия;
- Template source и Plugin binary имеют provenance;
- JSON output отделён от progress output;
- автоматический merge/rebase/force push не является универсальной Core-операцией;
- доверие к обнаруженной связи не выводится только из confidence модели.

## 18. Где хранится состояние

Нужно различить несколько видов состояния:

| Состояние | Возможный владелец |
|---|---|
| Specs, Changes, schema | OpenSpec Store |
| Live Store Orchestrator config | OpenSpec Store; читается при каждой операции |
| Future Project definition | не входит в v1 |
| Accepted Repository Graph | не входит в v1; позднее orchestration boundary |
| Candidate Graph | локальный cache или внешний catalog с provenance |
| Workspace paths и connection state | `.openspec-orch/state.json`, Core-managed local state |
| Snapshot | вычисляется из Git и фиксируется в local state |
| Assignment Result Receipts в v1 | versioned local state до composite verification |
| Результат composite verification в v1 | local state: `pass|fail`, источник и Snapshot |
| Installed Template assets | материализованный Store Context |
| Future Template/Plugin lock | не входит в v1 |
| Plugin config | не входит в v1; позднее Store или Project config без secrets |
| Credentials | системное credential storage или provider auth |

### 18.1. Принятая Git-first модель

Для первой версии отдельный сервер и база Orchestrator не нужны.

- принятые Specs, Change, Planning Scope/Change Binding, Design и Baseline должны
  разрешаться из версионируемого состояния Store;
- актуальный `openspec-orch.yaml` читается при каждой операции; его context можно
  менять без `init/connect`, а использованная config revision фиксируется в Handoff;
- `.openspec-orch/state.json` хранит локальный observed state и никогда не становится
  вторым пользовательским config;
- Assignment identity и Implementation Context производятся локально из Change,
  Baseline, текущего repository и его точной revision и не дублируют planning content;
- implementation branches, commits и проверяемые revisions принадлежат Git
  соответствующих Code Repositories;
- промежуточные Assignment Result Receipts в local-first v1 сохраняются в local state
  до composite verification и не создают отдельный Git-поток;
- результат composite verification также остаётся локальным в v1 и содержит только
  `pass|fail`, источник и точный Snapshot;
- результаты, которые в будущей командной версии должны пережить локальную сессию
  или участвовать в review, потребуют отдельного Git-first transport решения;
- machine-local paths, checkout status, временный runtime и cache остаются локальными
  и не становятся общим источником истины;
- Core может вычислять удобное представление общего статуса, но это представление
  восстанавливается из Git-состояния и не требует собственного server-side state.

При будущем переходе от одного инженера к команде сначала используется та же
Git-first модель. Отдельный индексатор или Control Plane рассматривается только
при появлении измеримой проблемы, которую нельзя решить через Store, Git refs,
PR/CI metadata и локальное вычисление.

### 18.2. Минимальный local state v1

Для первой версии достаточно одного schema-versioned `.openspec-orch/state.json`,
принадлежащего локальному Store Context/workspace. Это технический журнал observed
state и продолжения работы, а не новый источник требований, configuration или
planning state.

Он хранит только:

- Assignment identity: Change, Baseline и Repository;
- точные Store и repository revisions;
- Result Receipts;
- результаты orchestration gates;
- последний composite verification result и его Snapshot.

Надёжность обеспечивается без отдельной базы и сервера:

- runtime schema validation при каждом чтении;
- atomic replace при записи, чтобы незавершённый процесс не оставил половину файла;
- запрет параллельной записи одного workspace;
- перепроверка revisions по Git/OpenSpec вместо доверия кешу;
- явный `stale`, если состояние больше не соответствует revisions;
- безопасное восстановление вычислимых данных и повтор checks, Evidence которых
  потеряно или повреждено.

Подтверждение warning действует только на конкретный вызов и конкретный warning code.
Оно не сохраняется в local state как постоянное разрешение игнорировать будущие
предупреждения.

### 18.3. Критерии размещения нового состояния

Критерий выбора:

- нужно ли review;
- должна ли запись быть общей для команды;
- содержит ли она machine-local paths;
- содержит ли secrets;
- нужна ли воспроизводимость;
- каков lifecycle относительно Change.

## 19. Точки сравнения и источники идей

Следующему агенту полезно изучить не «один аналог продукта», а разные классы инструментов:

- **OpenSpec** — Change, Schema и Artifact Graph;
- **Nx Project Graph / affected-подход** — вычисление области изменений по графу;
- **Backstage Software Catalog** — каталог сущностей, отношений и ownership;
- **Bazel/Pants-подобные системы** — воспроизводимый граф целей и минимальный affected scope;
- **Google repo tool и multi-repo workspace managers** — материализация множества Git repositories;
- **Superpowers** — подключаемая агентская методология;
- **Matt Pocock skills и аналогичные skill packs** — переносимые agent capabilities;
- **CI orchestration и release manifests** — проверка набора точных revisions;
- **GitOps** — reviewable declarative state и reconciliation;
- **plugin systems с out-of-process protocol** — изоляция доверия и версионируемые capabilities.

Не следует копировать любой из этих продуктов целиком. Каждый из них является референсом только для отдельной части модели.

## 20. Что уже дала текущая реализация

Этот раздел нужен только как входной опыт. Он не должен ограничивать брейншторм.

### 20.1. Полезные подтверждённые направления

Текущий прототип показал практическую ценность:

- отдельного Core и Project Template;
- использования публичного OpenSpec CLI;
- центрального Store для multi-repo Change;
- безопасного `init` без silent overwrite;
- регистрации Store и подготовки workspace;
- проверки repository identity и revisions;
- structured OpenSpec responses вместо разбора свободного текста;
- Handoff между Store и implementation repository;
- strict и relaxed policies;
- изоляции team-specific instructions от built-in OpenSpec assets.

### 20.2. Ограничения текущего прототипа

Критические разрывы относительно минимальной модели v1:

- нет принятого Change Binding как минимальной связи Change с repositories;
- нет единого `status(change-id)` по всем Assignments;
- текущий implementation handoff требует вручную переносить служебные параметры;
- нет минимального Result Receipt contract и долговременного local state;
- нет общего Snapshot и простой composite verification точных revisions;
- часть agent flow и базовый Template процессно привязаны к текущему `spec-driven`
  сценарию сильнее, чем допускает schema-neutral цель;
- проверки локального harness не доказывают реальный end-to-end pilot на hosted
  repositories и поддерживаемых agent runtimes.

Следующие отсутствующие функции сознательно не считаются дефектами v1:

- Repository Graph, discovery, `affected`, graph path и graph explain;
- Template composition, versioning и update lifecycle;
- Plugins;
- полноценный multi-Store и участие repository в нескольких Store Contexts;
- серверный Control Plane и командная синхронизация Receipts.

### 20.3. Что не нужно сохранять только из-за наличия кода

Следующее может быть полностью пересмотрено:

- названия CLI-команд;
- обязательность ticket в Core;
- Store-centric discovery;
- фиксированная workspace layout;
- формат repo pointer;
- понятия `strict/relaxed`, если найдётся более ясная policy model;
- текущий Template descriptor;
- текущий порядок пользовательских шагов;
- привязка Explore к slash-команде;
- граница между локальным config и Store state.

## 21. Рабочая целевая модель первой полезной версии

Это не backlog реализации, а гипотеза минимального продукта, который уже имеет самостоятельную ценность.

### Core

- versioned Orchestrator config в Store;
- local-first работа без обязательного сервера;
- один Store как orchestration root;
- partial workspace;
- repository list/status/connect/safe sync;
- явный Planning Scope и минимальный Change Binding с заранее известными repositories;
- не более одного Assignment на repository в рамках Change;
- автоматическое создание Assignment identity текущего repository по Change Binding
  и Baseline;
- технический Implementation Context без содержательного implementation plan в Core;
- Snapshot точных revisions;
- schema-neutral OpenSpec bridge;
- structured Handoff;
- versioned Result Receipt contract с runtime schema validation и универсальными
  Git/OpenSpec consistency checks;
- сбор точного Snapshot и приём простого результата composite verification без
  исполнения project-specific checks внутри Core;
- проверка Assignment dependencies на стадии verification и обязательных Evidence
  без управления порядком написания кода и интерпретации бизнесового содержания;
- read-only doctor;
- единый JSON protocol;
- отсутствие обязательной семантики конкретной команды.

### Template ecosystem

- один выбранный Template при `init`;
- provider/agent adaptation;
- custom schema, commands, skills и handoff files;
- начальный общий `context` для `openspec-orch.yaml`;
- безопасная materialization без silent overwrite;
- отсутствие обязательной композиции и update lifecycle в v1.

### Future Plugin seam — граница, а не реализация v1

Первая версия не обязана содержать Plugin runtime, SDK или реальный Plugin. В её
контрактах достаточно не смешивать Template с исполняемыми интеграциями и сохранить
возможность позже добавить:

- capability manifest;
- out-of-process invocation;
- read-only first;
- structured input/output;
- contract test kit.

### Необязательное для первой версии

- marketplace;
- автоматическая публикация Templates;
- отдельный Project и multi-Store orchestration;
- Plugin runtime, SDK и executable hooks;
- универсальный static analysis всех языков;
- автоматический release orchestration;
- background daemon;
- hosted control plane;
- Repository Graph, автоматический discovery и `affected`;
- автоматические external writes;
- визуальный UI графа.

## 22. План развития от реальной проблемы

План намеренно не пытается заранее реализовать все идеи документа.

### Этап 1. Зафиксировать минимальные публичные контракты

1. Один `openspec-orch.yaml` с `context`, agent handoffs и repositories.
2. Явный Change ID во всех Change-layer operations.
3. Автоматическое разрешение и показ принятого Baseline.
4. Change Binding с заранее известным списком repositories.
5. Assignment identity `Change + Baseline + Repository`.
6. Общий `status(change-id)` для всех repositories.
7. Минимальные Implementation Context, Result Receipt и local state.
8. Простая composite verification: Snapshot и `pass|fail` с источником.

### Этап 2. Доказать вертикальный сценарий

Один инженер проводит один реальный Change через два или три repositories:

```text
connect → status → implement → record → verify
```

Проверяется не количество функций, а результат:

- не требуется вручную переносить Baseline и служебные IDs;
- после смены repository понятна его Assignment;
- после перезапуска не теряется состояние;
- общий status объясняет, что готово и что блокирует следующий gate;
- custom OpenSpec Schema не требует изменения Core;
- Template может использовать собственные commands/skills.

### Этап 3. Исправить проблемы пилота

После пилота исправляются только обнаруженные разрывы минимального сценария. Новая
абстракция добавляется лишь тогда, когда более простой локальный fix не решает
повторяющуюся проблему.

### Этап 4. Расширять только по наблюдаемому триггеру

| Наблюдаемая проблема | Допустимое следующее расширение |
|---|---|
| Общий `context` регулярно даёт лишние или конфликтующие инструкции | operation-specific context |
| Одного handoff mapping недостаточно для поддерживаемых agent runtimes | обобщённый entrypoint contract |
| Команда вручную совмещает несколько Templates и постоянно разрешает конфликты | Template Recipe/Composer |
| Инженер заранее не знает участвующие repositories и ошибается в Scope | Repository Graph/discovery |
| Ручная проверка CI/PR становится регулярной потерей времени | один read-only Plugin |
| Локальные Receipts нужно передавать между инженерами | Git transport для командного state |
| Один Store перестаёт описывать orchestration boundary | отдельный Project/multi-Store model |
| Git и локальное вычисление не справляются с командным статусом | оценка индексатора или Control Plane |

До появления соответствующего наблюдения расширение остаётся только исследовательской
идеей и не попадает в backlog v1.

## 23. Решения, которым, вероятно, понадобятся ADR

ADR следует писать только после выбора между реальными альтернативами. Наиболее вероятные темы:

1. **Введение отдельного Project после Store-centric v1.** Только при появлении
   подтверждённого multi-Store или multi-configuration сценария.
2. **Владелец Accepted Repository Graph.**
3. **Формат и lifecycle Snapshot.**
4. **Template composition и разрешение конфликтов.**
5. **Out-of-process Plugin protocol и trust boundary.**
6. **Модель участия repository в нескольких Store Contexts или будущих Projects.**
7. **Граница schema-defined gates и executable verification.**

Пока эти решения не приняты, их следует держать как вопросы, а не маскировать под детали CLI.

## 24. Отложенные исследовательские вопросы

Эти вопросы не являются следующим этапом и не должны блокировать v1. Каждый из них
возвращается в работу только по триггеру из раздела 22.

### О продукте

1. Как измерить выигрыш продуктового инженера на одной реальной задаче?
2. Какой сценарий даёт ценность уже на трёх repositories?
3. Нужен ли Orchestrator пользователю, который не использует AI-агентов?
4. Является ли OpenSpec обязательным engine или одним из возможных change providers в далёкой перспективе?

### О Store Context и возможном Project

6. Достаточна ли Store identity для всех сценариев первой версии?
7. Как один checkout выбирает активный Store Context без обязательного pointer?
8. Какой измеримый сценарий потребует отдельный Project?
9. Потребуется ли несколько независимых orchestration configurations на один Store?
10. Потребуется ли одна orchestration boundary для нескольких Stores?

### О графе

11. Какой реальный сценарий после v1 оправдывает появление Repository Graph?
12. Какие источники считаются authoritative?
13. Как принимаются candidates?
14. Как определяется stale edge?
15. Что именно означает `affected`?
16. Нужен ли граф между repositories, компонентами внутри repositories или оба уровня?
17. Как не превратить продукт в service catalog/CMDB?

### О Snapshot

18. Snapshot — долговечный artifact, runtime object или оба варианта?
19. Должен ли Snapshot включать dirty diff?
20. Как связать planning baseline и implementation revisions?
21. Как доказать, что composite verification относится к тому же Snapshot?

### О Template

22. Template materialized один раз или управляется lifecycle?
23. Как подключать несколько bundles?
24. Как обновлять bundle, не перетирая кастомизацию команды?
25. Где заканчивается декларативный Template и начинается Plugin?
26. Как разные agent runtimes объявляют capabilities?

### О Schema и gates

27. Какие gates являются только зависимостями артефактов?
28. Как Schema требует external Evidence?
29. Кто проверяет человеческое approval?
30. Что блокирует Archive технически, а что остаётся policy?

### О Plugins

31. Какой минимальный capability protocol?
32. Как передаются permissions?
33. Как различать read и write capabilities?
34. Как версионировать Plugin API?
35. Как выглядит contract test kit?

## 25. Критерии качества итоговой концепции

Концепция достаточно зрелая для перехода к реализации, если можно без ссылок на текущий код ответить:

- что является продуктом;
- кто его пользователь;
- какую регулярную боль он устраняет;
- чем Core отличается от OpenSpec, Template и Plugin;
- как определяется Scope;
- что делает Snapshot воспроизводимым;
- как работает Handoff;
- где хранится Evidence;
- какие gates относятся к Schema;
- как подключаются custom commands и skills;
- какое минимальное вертикальное поведение должно доказать ценность;
- какие функции сознательно не входят в первую версию.

## 26. Ожидаемый результат следующего разговора

Продуктовая и минимальная доменная модель уже зафиксированы. Следующий разговор не
должен заново открывать Repository Graph, Template composition, Plugins, multi-Store
или сервер. Его результатом должен стать проверяемый implementation plan только для
этапов 1–2 раздела 22:

1. сопоставить минимальную модель с текущим кодом без предположения, что существующий
   CLI уже выражает правильную архитектуру;
2. выделить минимальный end-to-end slice одного Change на двух repositories;
3. перечислить изменения публичных контрактов `openspec-orch.yaml`, API и local state;
4. определить migration/compatibility для текущего config и handoffs;
5. определить проверки, доказывающие schema neutrality и восстановление между
   сессиями;
6. составить последовательность небольших reviewable изменений;
7. не добавлять отложенную функцию без соответствующего измеримого триггера.

## 27. Стартовый prompt для нового агента

Ниже можно использовать как первый запрос в новом контексте:

```text
Прочитай концептуальный бриф целиком. Разделы 3.1, 3.2 и 22 являются принятым
scope lock и имеют приоритет над ранними исследовательскими гипотезами документа.

Проведи аудит текущего репозитория и подготовь implementation plan этапов 1–2:

1. Покажи разрыв между текущим кодом и минимальной моделью.
2. Спроектируй один end-to-end slice Change на двух Code Repositories.
3. Сохрани один user-owned openspec-orch.yaml с одним общим context и существующим
   handoff mapping; не вводи второй config или config language.
4. Сохрани OpenSpec Schema opaque для Core.
5. Добавь только необходимые Assignment, status, Result Receipt, Snapshot и local
   state contracts.
6. Опиши migration, тесты и последовательность reviewable изменений.
7. Не включай Graph, discovery, Template composition, Plugin runtime, сервер,
   multi-Store или командный transport Receipts без нового подтверждённого триггера.

Сначала представь план и риски. Не изменяй код до отдельного согласования.
```

## 28. Короткое резюме

Центральная идея не в автоматизации `init` и не в новом наборе slash-команд.

Первая самостоятельная ценность OpenSpec Orchestrator для одного продуктового
инженера состоит в том, чтобы:

1. зафиксировать известный Planning Scope как минимальный Change Binding;
2. принять Binding вместе с planning-артефактами на одном Store Baseline;
3. автоматически создать Assignment identity и Implementation Context текущего
   репозитория, оставив содержательный план Template и агенту;
4. зафиксировать точные revisions в Snapshot;
5. передать проверенный Handoff агенту, человеку или автоматизации;
6. собрать Evidence, относящееся к тому же Snapshot;
7. использовать OpenSpec для schema-defined Change lifecycle;
8. позволить заменить процесс, commands и skills через Template.

Командное использование развивается позже поверх той же Git-first модели. Repository
Graph, discovery, Plugins и серверный Control Plane не должны попадать в первую
версию только ради потенциального масштаба. Они добавляются лишь после появления
измеримого сценария, который нельзя достаточно хорошо решить явным Scope и Git.
