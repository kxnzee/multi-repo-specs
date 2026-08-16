> **Архивный документ.** Эта редакция больше не является актуальным источником
> требований. Актуальные границы задаёт
> [текущий продуктовый контракт](../technical/product-contract.md). Более поздняя полная
> редакция v1 также [сохранена в архиве](OpenSpec-Orchestrator-Product-Concept-Brief.md).

# OpenSpec Orchestrator: продуктовая концепция и scope lock v1

## 0. Статус и назначение документа

Статус документа: **архивная редакция 1; не является актуальным scope lock**.

Документ фиксирует:

- для кого создаётся OpenSpec Orchestrator;
- какую регулярную проблему он решает;
- границы OpenSpec, Orchestrator Core и Project Template;
- три слоя orchestration;
- минимальную доменную модель;
- целевой пользовательский сценарий;
- соответствие текущей реализации целевой модели;
- последовательность дальнейшей реализации;
- условия, при которых продукт можно распространять в разные команды;
- функции, сознательно отложенные за пределы v1.

Документ больше не является материалом для свободного брейншторма. Ранние
исследовательские модели Repository Graph, Plugin runtime, Template Composer,
multi-Store Project и server-side Control Plane удалены из основного описания. Они
могут вернуться только после появления измеримой проблемы, указанной в разделе 12.

Если этот документ конфликтует:

- с актуальной концепцией по ссылке в начале — актуальна новая концепция;
- с текущим CLI — документ описывает целевую модель, а CLI показывает текущее
  состояние реализации;
- с конкретным Project Template — Template может менять процесс команды, но не
  границы ответственности Core и OpenSpec;
- с OpenSpec Schema — Core должен адаптироваться к публичному контракту OpenSpec, а
  не требовать от Schema фиксированные имена и структуру артефактов.

Это ещё не техническая спецификация всех JSON-схем и state transitions. Точные
контракты должны быть определены в новом implementation plan. При этом implementation
plan не должен заново открывать продуктовые решения, уже зафиксированные здесь.

## 1. Продукт

### 1.1. Исходная проблема

Продуктовый инженер регулярно получает задачу, реализация которой затрагивает
несколько Git-репозиториев и один центральный OpenSpec Store. Обычно он заранее знает
основной список репозиториев, но вынужден вручную:

- развернуть или актуализировать локальное окружение;
- проверить ветки, remotes, незавершённые Git-операции и актуальность checkout;
- связать Change с участвующими репозиториями;
- помнить, на какой принятой revision Store был согласован план;
- переносить между командами Store ID, repository ID, Baseline, Work Package IDs и
  пути к planning-артефактам;
- объяснять агенту, что именно относится к текущему репозиторию;
- следить, чтобы агент не потерял границы задачи и не начал менять соседние области;
- фиксировать, что уже реализовано в каждом репозитории;
- проверять, что общий результат относится к одному согласованному набору revisions;
- восстанавливать контекст после переключения репозитория, агента или рабочей сессии.

Чем больше репозиториев и сложнее командный процесс, тем больше инженер выполняет
ручную координационную работу вместо реализации задачи. При смене Template, Schema
или набора skills ему приходится заново осваивать способ ведения процесса.

Git, OpenSpec, AI-агент и CI по отдельности не решают эту проблему:

- Git знает commits, branches и remotes, но не знает, какой набор репозиториев
  реализует один Change;
- OpenSpec владеет Specs, Changes, schemas и artifact lifecycle, но не обязан
  координировать локальные checkout нескольких репозиториев;
- AI-агент умеет анализировать и изменять код, но без точного технического контекста
  может потерять Change, Baseline, repository boundary или состояние других работ;
- CI проверяет конкретный commit или job, но сам по себе не доказывает, что несколько
  проверенных revisions вместе соответствуют одному принятому Change.

### 1.2. Первый пользователь

Первый пользователь — **один продуктовый инженер**, который один или несколько раз в
день получает и реализует задачи в системе из нескольких репозиториев.

Для v1 не требуется одновременная координация нескольких инженеров. Сначала продукт
должен доказать самостоятельную ценность в local-first сценарии одного человека.
После этого тот же Core можно распространять в разные команды, где каждая команда
использует свой Template и OpenSpec Schema.

Это необходимо отличать от совместной работы нескольких людей над одним runtime
state:

- **разные команды независимо используют продукт** — целевой сценарий после
  distribution gate v1;
- **несколько инженеров обмениваются Assignments и Result Receipts** — следующий этап,
  не входящий в v1.

### 1.3. Определение продукта

OpenSpec Orchestrator — local-first, Git-first и schema-neutral координатор
мультирепозиторной реализации OpenSpec Change.

Короткая формулировка:

> Orchestrator связывает принятый OpenSpec Change с заранее известными
> репозиториями, точным Baseline, локальными Assignments и проверяемым результатом на
> точных revisions.

Целевой уровень Core — не набор shell-скриптов и не бизнесовый planning engine, а
**координатор процесса**. Core понимает технические identity и связи между Change,
Baseline, Repository, Assignment, Result Receipt и Snapshot, но не интерпретирует
бизнесовый смысл требований и Acceptance Criteria.

### 1.4. Самостоятельная ценность v1

Первая полезная версия должна доказать один сценарий:

> Один продуктовый инженер проводит один принятый OpenSpec Change через два или три
> заранее известных репозитория, не перенося вручную Baseline, Work Package IDs и
> состояние работы между сессиями.

Минимальный путь:

```text
(init | adopt) → first local connect
    ↓
OpenSpec/Template creates Change → plan(change-id)
    ↓
assign(change-id, repository IDs) → accepted Change Binding + Baseline
    ↓
status(change-id)
    ↓
implement(change-id) в каждом repository через Template handoff
    ↓
Result Receipts
    ↓
verify(change-id) на точном Snapshot
```

### 1.5. Чем продукт не является

Orchestrator не является:

- заменой OpenSpec;
- новым форматом Specs и Changes;
- собственным task tracker;
- универсальной CI/CD-системой;
- Git hosting platform;
- системой управления релизами;
- обязательным агентским фреймворком;
- жёстко заданной SDD-методологией одной команды;
- собственным содержательным planning engine;
- системой, которая сама принимает архитектурные решения;
- механизмом скрытого запуска произвольного кода из Template;
- командой `exec --all`, бесконтрольно выполняющей действия во всех репозиториях;
- владельцем OpenSpec Archive.

## 2. Зафиксированный scope v1

### 2.1. Входит в v1

В первую самостоятельную версию входят:

1. Один OpenSpec Store как orchestration root.
2. Один user-owned `openspec-orch.yaml`.
3. Один общий редактируемый `context` в этом файле.
4. Заранее известный repository registry.
5. Repository Lifecycle: `init` нового проекта, `adopt` существующего OpenSpec-проекта,
   повторный `connect`, status, safe sync и позднее безопасный disconnect.
6. Явный Change ID во всех Change-level и implementation operations.
7. Schema-neutral `plan(change-id)` как optional Template handoff; существующий
   процесс может перейти сразу к `assign`.
8. `assign(change-id, repository IDs)`, принимающий Change Binding и автоматически
   разрешённый Planning Baseline.
9. Не более одного Assignment на repository для сочетания Change и Baseline.
10. Технический Implementation Context без копии содержательного плана.
11. Template handoff к agent-facing command или skill.
12. Небольшой versioned Result Receipt с runtime validation.
13. Один Core-managed local state document.
14. Aggregate `status(change-id)` по всем repositories Change.
15. Snapshot точных implementation revisions.
16. Простая composite verification: `pass|fail`, источник и тот же Snapshot.
17. Поддержка произвольной OpenSpec Schema без ветвления Core по её имени.
18. Human-readable и единый структурированный JSON output.
19. Явная семантика warnings и errors.
20. Реальный вертикальный пилот на двух или трёх repositories.
21. Безопасное подключение Orchestrator к существующему OpenSpec-проекту без замены
    его Schema, config, specs, Changes и agent-facing процесса.
22. Минимальный compatibility contract, позволяющий связать существующие команды и
    skills команды с Core handoffs и Result Receipt.

### 2.2. Не входит в v1

В v1 сознательно не входят:

- Repository Graph;
- автоматический discovery и вычисление `affected`;
- автоматическое изменение Change Binding по найденным зависимостям;
- отдельная сущность Project;
- multi-Store orchestration;
- Template composition, Recipe или Composer;
- управление версиями и автоматическое обновление уже материализованного Template;
- автоматическая миграция существующего процесса команды на другой Template;
- operation-specific context в `openspec-orch.yaml`;
- второй Git-tracked Orchestrator config или lockfile;
- Plugin runtime, SDK и marketplace;
- автоматическое чтение Jira, CI, PR или service catalog;
- server-side Control Plane, daemon или индексатор;
- командная синхронизация локальных Result Receipts;
- автоматические external writes;
- собственное управление OpenSpec Archive;
- универсальное выполнение project-specific проверок внутри Core.

Отсутствие этих функций не является дефектом v1.

## 3. Границы ответственности

Три orchestration layer и три основных владельца ответственности — разные оси
модели. Repository, Change и Assignment описывают масштаб операции. OpenSpec, Core и
Template определяют, кто владеет конкретным поведением и данными.

### 3.1. OpenSpec

OpenSpec остаётся единственным владельцем:

- Specs;
- Changes;
- schemas;
- artifact graph;
- schema-defined artifacts;
- instructions для создания артефактов;
- status и validation OpenSpec-состояния;
- штатных `opsx-*` commands и `openspec-*` skills;
- sync и archive lifecycle.

Core вызывает только публичный OpenSpec CLI и проверяет структурированные ответы.
Core не вычисляет пути артефактов по известному layout и не подменяет OpenSpec
собственной реализацией artifact graph.

### 3.2. Orchestrator Core

Core владеет универсальной технической координацией:

- Store и repository identity;
- разбором `openspec-orch.yaml`;
- локальным workspace и observed state;
- безопасными Git-операциями;
- Change Binding coordination;
- разрешением Planning Baseline;
- Assignment identity;
- Implementation Context;
- безопасным Handoff;
- структурой и consistency validation Result Receipt;
- aggregate status;
- Snapshot точных revisions;
- собственными orchestration gates;
- human и JSON diagnostics.

Core может проверить универсальные Git/OpenSpec facts, но не должен:

- понимать бизнесовую цель Change;
- интерпретировать Acceptance Criteria;
- генерировать содержательный implementation plan;
- требовать конкретные planning artifacts;
- выполнять произвольные команды из Schema;
- объявлять project-specific test suite пройденной без внешнего результата;
- определять процесс команды;
- блокировать OpenSpec Archive.

### 3.3. Project Template

Project Template определяет team-specific и agent-facing слой:

- OpenSpec config и project-local schemas;
- начальные project assets;
- agent mapping;
- commands;
- skills;
- subagents;
- постоянные инструкции;
- начальный общий `context`;
- handoff mappings;
- способ планирования, реализации и project-specific verification.

Template является декларативным набором файлов. Core не запускает lifecycle hooks или
произвольный executable code из Template.

Роль Template зависит от явно вызванной операции. В Repository Layer различаются
два режима его использования.

`init` создаёт новый OpenSpec-проект и выбирает ровно один полный Bootstrap Template:

- без `--template` используется базовый Template;
- явный Template полностью заменяет базовый;
- Templates автоматически не смешиваются;
- после `init` скопированные assets принадлежат проекту;
- изменение этих assets не требует повторного `init`;
- обновление Core не перезаписывает их автоматически.

`adopt` подключает Orchestrator к существующему OpenSpec-проекту и не накрывает его
базовым Template. Core сначала исследует уже имеющиеся OpenSpec и agent-facing assets.
Для связывания процесса может использоваться минимальное декларативное
mapping-описание или Compatibility Template, которое:

- указывает существующие planning, implementation и verification handoffs;
- добавляет только отсутствующие Orchestrator bridge assets;
- может не копировать ни одного файла, если процесс уже удовлетворяет контракту;
- не получает владение существующими commands, skills, instructions или schemas;
- завершает работу ошибкой при конфликте путей и ничего не перезаписывает молча.

Template может использовать Superpowers, Matt Pocock skills или собственные skills и
commands команды. Core не требует, чтобы основным пользовательским UX были
`/opsx-*` commands.

### 3.4. Агент или человек

Агент или человек:

- читает произвольные planning-артефакты выбранной Schema;
- строит актуальный локальный implementation plan;
- определяет внутренний порядок Tasks;
- изменяет код в разрешённом repository;
- выполняет project-specific checks;
- честно фиксирует результат и источник Evidence.

Core не хранит каждую мысль агента, его временный task list или полную историю
реализации.

### 3.5. Будущая исполняемая интеграция

Если расширение должно программно обращаться к Jira, GitHub, Bitbucket, CI, service
catalog или другой внешней системе, оно не должно маскироваться под Template.

Такая возможность в будущем может быть реализована отдельным Plugin с явными:

- capability;
- structured input/output;
- permissions;
- trust boundary;
- read/write семантикой;
- аудитом внешних изменений.

Plugin runtime не входит в v1. В текущей архитектуре достаточно не закрыть возможность
его последующего добавления.

### 3.6. Значение `openspec_adapter`

`openspec_adapter` не является общим адаптером Core к произвольному Template.

В текущей модели это agent/provider ID, который Core передаёт штатному:

```text
openspec init --tools <openspec_adapter>
```

Граница Core и Template для последующей работы задаётся прежде всего сохранённым agent
mapping и `agent.handoffs`. Новый общий adapter layer в v1 не вводится. Он понадобится
только если несколько реально поддерживаемых agent runtimes нельзя будет обслужить
одним структурированным Handoff/Receipt contract.

### 3.7. Матрица ответственности

| Объект или операция | Владелец |
|---|---|
| OpenSpec Change, Schema и artifacts | OpenSpec |
| `openspec/config.yaml` | OpenSpec project, начальное значение может поставить Template |
| `openspec-orch.yaml` | Пользователь, Core валидирует и читает |
| `.openspec-orch/state.json` | Core, machine-local observed state |
| Repository registry | Пользователь в `openspec-orch.yaml` |
| Workspace и checkout routing | Core |
| Change Binding и Baseline coordination | Core поверх принятого OpenSpec planning state |
| Содержательный plan | OpenSpec artifacts + Template + агент/человек |
| Agent-facing planning process | Template |
| Assignment identity | Core |
| Implementation Context | Core |
| Agent-facing implementation process | Template |
| Изменение кода | Агент/человек |
| Result Receipt structure и consistency | Core |
| Project-specific checks | Template, агент, человек, CI или будущий Plugin |
| OpenSpec Archive | OpenSpec и пользовательский процесс |

### 3.8. Compatibility contract существующего процесса

Команде не нужно отказываться от уже построенного процесса ради Orchestrator. При
Adoption сохраняются её:

- `openspec/config.yaml`, project-local schemas, Specs и активные Changes;
- штатные и кастомные OpenSpec commands и skills;
- Superpowers, Matt Pocock skills или другая методология;
- инструкции агентам, branch/PR flow, CI и ручные gates.

Core требует от этого процесса не конкретных названий команд и не определённой формы
плана, а только минимальных точек совместимости:

1. optional planning handoff получает schema-neutral planning context; если команда
   планирует вне Orchestrator, она может перейти сразу к `assign`;
2. implementation handoff получает сформированный Core Implementation Context;
3. verification handoff может проверить согласованный Snapshot;
4. результат реализации нормализуется в versioned Result Receipt;
5. OpenSpec bridge использует публичные возможности OpenSpec, не читая внутренний
   layout как скрытый API.

Если существующая команда реализации не умеет создавать Receipt, рядом с ней
добавляется тонкий bridge: он вызывает существующую команду, а затем приводит её
структурированный результат к Core contract. Бизнесовый процесс при этом остаётся в
существующей команде, а bridge не дублирует его.

Handoffs проверяются лениво. Отсутствие planning, implementation или verification
handoff не мешает выполнить
Repository Layer `init/adopt/connect`; оно становится ошибкой только при вызове
операции, которой этот handoff действительно нужен. Благодаря этому Orchestrator
можно подключать по слоям, не требуя одномоментной переделки всего процесса.

## 4. Три orchestration layer

### 4.1. Общая последовательность

```text
Repository Layer
init | adopt ──→ connect ──→ repository status ──→ repository sync ──→ disconnect
                       ↑
connect ───────────────┘
                       │
                       ▼
Change Layer
plan(change-id) → assign(change-id, repositories) → status(change-id)
                         │
                         ▼
Assignment/Implementation Layer
implement(change-id, repository) → record(change-id, Receipt)
                                      │
                                      ▼
Change-level completion: verify(change-id) on exact Snapshot
```

Repository Layer используется многократно для разных Changes. Change Layer создаёт
общую координационную рамку одного Change. Assignment/Implementation Layer повторяет
реализацию для каждого repository из принятого Binding. `status` и `verify`
остаются Change-level операциями, потому что агрегируют все Assignments.

Канонические имена ниже фиксируют публичные операции Core. Точная CLI-форма
позиционных аргументов и флагов должна быть доведена в implementation plan, но
назначение команд и обязательность `change-id` меняться не должны.

### 4.2. Repository Layer

#### Назначение Repository Layer

Repository Layer создаёт и поддерживает технически пригодный локальный workspace из
OpenSpec Store и заранее объявленных Code Repositories.

Он отвечает на вопросы:

- какой Store является orchestration root;
- какие repositories объявлены пользователем;
- где находятся локальные checkouts;
- соответствуют ли remote и default branch конфигурации;
- является ли checkout missing, clean, dirty, stale или diverged;
- какое действие можно безопасно выполнить;
- требуется ли подтверждение пользователя.

#### Входы Repository Layer

- `openspec-orch.yaml`;
- Store identity и Git remote;
- repository registry;
- явно вызванная операция `init` или `adopt`;
- полный Bootstrap Template для `init` либо минимальное Adoption mapping для `adopt`,
  если оно требуется;
- фактическое Git/OpenSpec-состояние локальной машины.

#### Выходы Repository Layer

- созданный или обнаруженный Store;
- проверенные локальные пути;
- machine-local connection state;
- repository status и diagnostics;
- безопасно обновлённый checkout либо явный warning/error.

#### Lifecycle

```text
init  ─┐
       ├→ first local connect → status → safe sync → disconnect
adopt ─┘
                         ▲
                         └── connect на другой машине или после потери local state
```

#### Публичные команды Repository Layer

| Команда | Когда вызывается | Результат | Чего не делает |
|---|---|---|---|
| `init` | OpenSpec-проекта ещё нет | Новый проект из одного Bootstrap Template, Store identity и first local connect | Не подключает существующий OpenSpec-проект |
| `adopt` | Валидный OpenSpec-проект уже существует | Preserve-first подключение Core, compatibility report и first local connect | Не переустанавливает OpenSpec, Schema, commands или skills |
| `connect` | Проект уже инициализирован или подключён | Восстановленный machine-local workspace и observed state | Не переписывает desired config |
| `repository status` | В любой момент после подключения | Read-only срез Store и всех checkouts с причинами drift | Не исправляет состояние |
| `repository sync` | Status показал безопасно устранимый drift | Явное безопасное обновление одного или явно выбранных repositories | Не уничтожает local changes и не меняет revision молча |
| `disconnect` | Local workspace больше не должен считаться подключённым | Удалена только machine-local связь и вычислимое state | Не удаляет Store, repositories, config или Changes |

#### Две явные команды создания связи с проектом

Публичный UX выражает намерение названием команды:

```text
openspec-orch init     # создать новый OpenSpec-проект через Template
openspec-orch adopt    # подключить существующий OpenSpec-проект
```

Обе команды начинают с read-only preflight, но не выбирают намерение за пользователя:

| Команда и состояние | Результат |
|---|---|
| `init`, OpenSpec-проекта ещё нет | Создание через полный Template |
| `init`, валидный OpenSpec-проект уже есть | Error без записей: использовать `adopt` |
| `adopt`, валидный OpenSpec-проект есть | Preserve-first подключение Orchestrator |
| `adopt`, OpenSpec-проекта нет | Error без записей: использовать `init` |
| Orchestrator уже полностью настроен | Идемпотентная проверка и local connect |
| Состояние частичное, конфликтующее или неоднозначное | Error с recovery report, без записей |

Определение строится не по одному наличию каталога `openspec/`, а по публичным
OpenSpec diagnostics и проверенным Orchestrator metadata. Core устанавливает наличие
валидного OpenSpec root, но не переключает команду на другую операцию молча.

Существующие флаги не отменяются: `--store`, `--agent` и `--repo` являются общими
входами, а `--template` относится к созданию нового проекта через `init`. Если
`adopt` потребуется внешний Compatibility mapping, его отдельный точный input
contract фиксируется implementation plan и не маскируется под полный Bootstrap
Template. В interactive запуске команда может спросить отсутствующие значения и
confirmation для конкретных warnings. В non-interactive запуске необходимые
identities передаются флагами, а неподтверждённый warning возвращается как
`needs_confirmation` без side effects. Флаг `--mode` не нужен: намерение выражено
командой `init` или `adopt`.

Целевой non-interactive UX:

```text
openspec-orch init . --store <store-id> --agent <agent-id> --template <path>
openspec-orch adopt . --store <store-id> --agent <agent-id>
```

Повторяемые `--repo <id=url#branch>` доступны обеим командам.

**`init`** предназначен для старта с нуля:

1. Проверяет отсутствие конфликтующей установки Orchestrator.
2. Проверяет полный Bootstrap Template до записи.
3. Вызывает публичный `openspec init` с выбранным provider ID.
4. Устанавливает provider pack и применяет ровно один полный Template.
5. Создаёт начальные OpenSpec assets и `openspec-orch.yaml`.
6. Создаёт или регистрирует Store.
7. Не перезаписывает уже существующие отличающиеся файлы.

**`adopt`** предназначен для существующего OpenSpec-проекта и процесса:

```text
inspect → internal plan → configure/register → add bridges → connect → doctor
```

1. Выполняет read-only inspection OpenSpec Store, config, schemas, Specs, Changes,
   agent directories, commands, skills и инструкций.
2. Строит внутренний adoption plan: что будет сохранено, что создано и какие
   конфликты найдены. Отдельной пользовательской команды для plan нет.
3. Безопасные добавления выполняет как обычную часть `adopt`; спрашивает confirmation
   только при конкретном warning.
4. Не запускает повторный OpenSpec bootstrap и не заменяет provider pack по
   умолчанию.
5. Сохраняет без изменений `openspec/config.yaml`, project-local schemas, Specs,
   Changes и существующие agent assets.
6. Создаёт только Orchestrator-owned config/metadata и при необходимости отсутствующие
   bridge handoffs.
7. Связывает существующие команды с Compatibility contract.
8. Завершает работу compatibility report и `doctor`; конфликт существующего файла
   является error, а не разрешением на overwrite.

##### Как `adopt` определяет существующий OpenSpec-проект

`adopt` не считает один файл или каталог достаточным доказательством. Он различает три
связанных, но независимых понятия:

| Понятие | Что означает | Может отсутствовать до `adopt` |
|---|---|---|
| OpenSpec root | Фактический проект с валидной OpenSpec planning-структурой | Нет |
| Store identity | Committed metadata `.openspec-store/store.yaml` с устойчивым Store ID | Да |
| Local Store registration | Машинная запись `Store ID → checkout path` в registry OpenSpec | Да |

Главным доказательством является OpenSpec root, а не Store registration. Регистрация
может отсутствовать на новой машине, указывать на другой checkout или остаться после
удаления файлов.

Read-only preflight выполняется в следующем порядке:

1. Канонизирует переданный `path` и проверяет Git root/remote в рамках выбранной
   strict policy.
2. Через публичный `openspec context --json` разрешает ближайший OpenSpec root.
3. Требует, чтобы разрешённый root точно совпадал с переданным target.
4. Через `openspec doctor --json` проверяет здоровье root и получает
   machine-readable diagnostics.
5. Проверяет существующую Store identity и локальный Store registry.
6. Проверяет наличие и состояние `openspec-orch.yaml` и Orchestrator metadata.
7. Исследует существующие agent/provider directories, commands, skills и возможные
   handoffs.
8. Только после полного read-only прохода строит внутренний write plan.

Точное совпадение root обязательно. Если команда запущена в Code Repository, чей
`openspec/config.yaml` лишь указывает на внешний Store, OpenSpec может разрешить этот
Store как `declared` root. `adopt` не должен принять Code Repository за Store: он
возвращает error с точным путём разрешённого Store и предлагает запустить команду там.
То же относится к root, найденному через machine-level default Store.

##### Как `adopt` работает со Store identity

После подтверждения здорового root возможны четыре основных состояния:

| Состояние | Действие |
|---|---|
| Identity и registration отсутствуют | Предложить Store ID и вызвать публичный `openspec store register <path> --id <id>` с подтверждением создания metadata |
| Identity есть, registration отсутствует | Взять ID из metadata и зарегистрировать этот checkout |
| Identity и registration согласованы | Переиспользовать их без записи |
| ID, path или remote конфликтуют | Error без изменения registry или файлов |

Для существующего здорового OpenSpec root используется `openspec store register`, а
не `openspec store setup`: `register` не создаёт Schema, Specs или Changes. Если
Store identity отсутствует, публичный OpenSpec CLI может создать только
`.openspec-store/store.yaml` после явного подтверждения. `adopt` проверяет
структурированный ответ и затем повторяет:

```text
openspec store doctor <store-id> --json
openspec doctor --store <store-id> --json
openspec context --store <store-id> --json
```

Store ID не угадывается молча. В interactive режиме можно предложить имя Git
repository как default, но пользователь его подтверждает. В non-interactive режиме
ID передаётся через `--store`. Если `.openspec-store/store.yaml` уже содержит ID, он
имеет приоритет; несовпадающий `--store` является error.

##### Как `adopt` связывает существующий agent process

Наличие каталога `.qwen/`, `.codex/` или другого provider pack не доказывает, какая
команда является implementation handoff. Поэтому `adopt`:

1. Получает или подтверждает `agent.id`.
2. Может предложить найденные provider directories, но не выбирает между несколькими
   кандидатами молча.
3. Сохраняет подтверждённые безопасные paths и handoff mappings в
   `openspec-orch.yaml`.
4. Не копирует полный Template поверх существующего provider pack.
5. При необходимости добавляет только новый bridge-файл на незанятом path.
6. Не требует planning/implementation/verification handoff для завершения Repository Layer:
   соответствующая operation даст lazy error, пока mapping не будет добавлен.

Таким образом, Template обязателен для `init`, но полный Bootstrap Template не
является обязательным входом `adopt`. Adoption нужен agent mapping, который может быть
получен из явных параметров, существующего процесса и минимального Compatibility
mapping.

##### Что `adopt` имеет право изменить

Обычный безопасный write plan ограничен следующими объектами:

- `.openspec-store/store.yaml`, только если Store identity отсутствует и создание
  подтверждено пользователем;
- `openspec-orch.yaml`;
- machine-local `.openspec-orch/state.json`;
- отсутствующие project-owned bridge handoffs, если они явно включены в plan;
- local OpenSpec Store registry;
- local connection state и Code Repository pointers в рамках обычного `connect`.

`adopt` не изменяет:

- `openspec/config.yaml` или `openspec/config.yml`;
- project-local schemas;
- Master Specs;
- активные и архивные Changes;
- существующие commands, skills и agent instructions;
- существующие provider packs;
- Git history, commits, branches или remote state.

Core не коммитит и не пушит созданные Git-tracked файлы. Итоговый report явно
отделяет `preserved`, `created`, `registered`, `connected`, `warnings` и `errors`.

##### Идемпотентность и частичное состояние

Повторный `adopt` для полностью подключённого проекта не переустанавливает assets. Он
перепроверяет Store identity, registration, config и local connection, после чего
показывает status.

Существующая `.openspec-store/store.yaml` без `openspec-orch.yaml` является нормальным
входом Adoption, а не ошибкой: команда должна добавить только Orchestrator. Но
повреждённый `openspec-orch.yaml`, несовместимая config version, занятый bridge path
или противоречащие друг другу identity считаются recovery/error state.

Все проверки и file-diff рассчитываются до первой записи. Полной транзакции между Git
files и машинным OpenSpec registry гарантировать нельзя, поэтому apply path должен
быть идемпотентным: при сбое повторный `adopt` либо безопасно завершает недостающий
шаг, либо выдаёт recovery report. Он не выполняет широкого rollback с удалением
пользовательских файлов.

Типовые результаты preflight:

| Результат | Пример |
|---|---|
| Success | Здоровый root, согласованная Store identity, все target paths свободны |
| Info | Необязательный planning/implementation/verification handoff пока не настроен |
| Warning + confirmation | Нужно создать Store identity; Git checkout dirty |
| Error | OpenSpec root отсутствует или нездоров; разрешён другой root; Store ID/path конфликтует; существующий файл пришлось бы перезаписать; Orchestrator config повреждён |

Warning не передаёт Core право исправлять процесс команды. После подтверждения Core
выполняет только уже показанные безопасные additions. Error продолжить не позволяет.

Adoption является отдельной операцией Repository Layer. Это не четвёртый слой, не
Template Composer и не автоматическая миграция процесса команды.

После успешного `init` или `adopt` тот же запуск выполняет local connect для текущей
машины и показывает итоговый Repository status. Поэтому первичное создание или
подключение проекта завершается одной командой. Самостоятельный `connect` сохраняется
как идемпотентная операция для другой машины, повторного открытия workspace или
ручного восстановления связи.

`connect`:

- заново читает актуальный `openspec-orch.yaml`;
- проверяет Store и OpenSpec;
- обнаруживает или создаёт workspace;
- подключает объявленные repositories;
- не переписывает пользовательский config;
- обновляет только observed local state.

Repository `status`:

- является read-only операцией;
- сравнивает desired config с фактическими checkouts;
- показывает missing, dirty, diverged, stale и identity mismatch;
- объясняет следующее безопасное действие.

Safe `sync`:

- работает только с однозначно разрешённым repository;
- не уничтожает локальные изменения;
- не переключает ветку или revision молча;
- при допустимом риске возвращает warning с выбором;
- при неоднозначности или невозможности сохранить корректность возвращает error.

`disconnect`:

- удаляет только машинную связь и вычислимый local observed state;
- не удаляет remote repository;
- не удаляет Change;
- не изменяет пользовательский `openspec-orch.yaml`;
- не обязан блокировать первый вертикальный пилот, если status и safe sync уже
  обеспечивают воспроизводимую работу.

#### Не входит в Repository Layer

- выбор repositories конкретного Change;
- чтение Design и Tasks;
- создание Assignment;
- implementation plan;
- Result Receipts;
- composite verification;
- автоматический dependency discovery.

#### Критерий готовности Repository Layer

Из чистого окружения можно создать новый проект через `init` или подключить
существующий через `adopt`, повторно открыть workspace через `connect`, получить
полный status и безопасно устранить или объяснить repository drift без ручной
пересборки окружения.

### 4.3. Change Layer

#### Назначение Change Layer

Change Layer связывает один принятый OpenSpec Change с точным Planning Baseline и
подтверждённым списком участвующих repositories.

Он отвечает на вопросы:

- какой Change рассматривается;
- какая принятая Store revision является его Baseline;
- какие repositories входят в Change Binding;
- какие Assignment identities следуют из Binding;
- каков aggregate status всего multi-repository Change;
- какое условие последнего orchestration gate является missing, failed или stale.

#### Входы Change Layer

- явный `change-id`;
- OpenSpec Change и его planning state;
- принятый Planning Baseline;
- подтверждённый Change Binding;
- repository registry;
- local Result Receipts и gate results.

#### Выходы Change Layer

- явно показанный Baseline;
- набор Assignment identities;
- `status(change-id)` по всем repositories;
- причины missing, failed и stale;
- данные для перехода к Implementation Layer;
- итоговый Snapshot и composite verification result.

#### Lifecycle Change Layer

```text
plan(change-id)
    → OpenSpec/Template planning handoff
    → assign(change-id, repository IDs)
    → accept Binding and current Planning Baseline
    → derive Assignment identities
    → status(change-id)
    → implement/record each Assignment
    → verify(change-id) on exact Snapshot
```

`plan` и `assign` разделены намеренно. `plan` помогает пройти процесс
планирования, которым владеют OpenSpec и Template. `assign` фиксирует только
техническую рамку Core: принятые Binding, Baseline и вытекающие Assignment
identities. Поэтому Core не должен распознавать конкретный формат
`proposal.md`, `design.md`, `tasks.md` или любой другой Schema.

#### Публичные команды Change Layer

| Команда | Обязательный вход | Результат | Владелец содержания |
|---|---|---|---|
| `plan(change-id)` | Явный Change ID | Проверенный planning context и вызов настроенного planning handoff | OpenSpec + Template + агент/человек |
| `assign(change-id, repository IDs)` | Change ID и явно принимаемый список repositories | Принятые Binding и Baseline, по одной Assignment identity на repository | Core владеет identity; пользователь принимает scope |
| `status(change-id)` | Change ID | Read-only aggregate по Binding, Assignments, Receipts, Snapshot и gates | Core агрегирует факты |
| `verify(change-id)` | Change ID | Snapshot точных revisions и composite result `pass|fail` с источником | Core проверяет universal gates; Template/агент/человек — project-specific gates |

##### `plan(change-id)`

`plan` — стабильная точка входа Orchestrator в планирование, а не новый
planning engine. Core:

1. Разрешает Store и явно переданный Change ID.
2. Проверяет Repository Layer и показывает drift, который может сделать план
   недостоверным.
3. Формирует schema-neutral planning context: Change ID, Store, repository registry,
   актуальные revisions и user-owned context.
4. Вызывает `agent.handoffs.plan` из Template/Compatibility mapping.
5. Не парсит и не переписывает planning artifacts.
6. Завершается read-only summary и явным следующим шагом `assign`, когда план
   принят.

Команда не является единственным допустимым способом планирования. Существующая
команда команды, `/opsx-*` или другой skill может подготовить тот же OpenSpec
planning state. После этого `assign` даёт Core одинаковый технический вход.

##### `assign(change-id, repository IDs)`

`assign` не назначает людей, не создаёт Tasks и не определяет порядок
реализации. Команда:

1. Получает Change ID и явный список repository IDs.
2. Проверяет, что каждый ID объявлен в Repository Layer.
3. Разрешает текущую accepted planning revision как Baseline; обычный
   пользователь не передаёт revision вручную.
4. Показывает Binding, Baseline и будущие Assignments до первого принятия или
   изменения scope.
5. Требует confirmation при замене ранее принятого Binding/Baseline, потому что
   это сделает прежние Receipts и verification stale.
6. Создаёт или возвращает детерминированные Assignment identities.

Повтор с теми же Change, Binding и Baseline идемпотентен. Изменившийся список
repositories или новая accepted planning revision не являются тихим обновлением.

##### `status(change-id)`

`status` ничего не меняет. Он каждый раз переразрешает config, OpenSpec state, Binding,
Baseline, Git revisions, Receipts и последний verification result. Он не доверяет
сохранённому local state без сверки и не выбирает текущий repository как скрытый
фильтр.

##### `verify(change-id)`

`verify` завершает координационный цикл Change, но не архивирует OpenSpec
Change. Команда строит точный Snapshot, проверяет universal gates, вызывает
настроенный verification handoff и фиксирует `pass|fail` только для этого Snapshot.
Подробный алгоритм описан в разделе 4.5.

#### Planning Scope и Change Binding

Пользователь в большинстве случаев знает исходный список repositories. Этот список
участвует в планировании, потому что Design и распределение работ зависят от принятого
Scope.

Planning Scope фиксируется в минимальном Change Binding:

```text
Change Binding = Change ID + accepted list of repository IDs
```

Binding не содержит:

- Tasks;
- Work Packages;
- целей;
- Acceptance Criteria;
- порядка реализации;
- копии Design;
- собственного Execution Plan.

Planning-agent может предложить добавить или удалить repository с причиной, но
пользователь явно подтверждает итоговый Binding. Если после принятия обнаружен новый
обязательный repository, необходимо:

1. обновить planning-артефакты;
2. повторно согласовать изменение;
3. принять новый Baseline;
4. не переносить существующие Assignments и Receipts на него молча.

#### Baseline rules

- Baseline разрешается из принятой planning revision, а не из текущего Store `HEAD`;
- обычный пользователь не обязан передавать Baseline вручную;
- использованный Baseline всегда показывается в human и JSON output;
- операция фиксирует Baseline на время вызова;
- новый Baseline не изменяет старое Assignment;
- `expected-baseline` допускается только как assertion для автоматизации;
- mismatch `expected-baseline` является error, а не способом выбрать старую revision.

#### Aggregate status

`status(change-id)` показывает:

- Change ID;
- принятый Baseline;
- Change Binding;
- все Assignments;
- наличие и актуальность Result Receipts;
- composite verification;
- последний orchestration gate;
- точные причины missing, failed или stale.

Текущий repository, если он определяется однозначно, только выделяется в human output
и получает `is_current: true` в JSON. Он не ограничивает результат неявно. Для
локального представления требуется явный repository filter.

#### Вычисляемые состояния Change Layer

Core не даёт пользователю свободно выставлять статус Change. Он вычисляет его из
фактов:

| Условие | Смысл | Следующее действие |
|---|---|---|
| Change не найден или OpenSpec state невалиден | Error: identity или planning state не могут быть разрешены | Исправить OpenSpec state; confirmation недоступен |
| Binding ещё не принят | Change ещё не разложен на Assignments | Выполнить planning flow и `assign` |
| Binding и Baseline актуальны | Assignments готовы к локальной реализации | Вызывать `implement` в нужных repositories |
| Часть Receipts missing/failed | Change реализован не полностью | Завершить или повторить соответствующие Assignments |
| Binding, Baseline, config или revisions изменились | Прежние Assignments, Receipts или verification могут быть `stale` | Перепринять Binding/Baseline или повторить затронутый цикл |
| Все Receipts актуальны | Можно строить Snapshot | Вызвать `verify(change-id)` |
| Verification `pass` на том же Snapshot | Оркестрационный цикл доказан для этих revisions | Дальнейший Archive выполняется вне Core |

Эти условия задают семантику. Точные enum names и переходы для JSON/local state
фиксируются в implementation plan.

#### Владение планированием

Содержательное планирование выполняют OpenSpec, Template, агент и человек. Core не
создаёт альтернативный planning engine. Он начинает координацию после того, как
planning result можно связать с точным Baseline и принятым Binding.

#### Не входит в Change Layer

- интерпретация бизнесового смысла Change;
- обязательность `proposal.md`, `design.md` или `tasks.md`;
- локальный implementation plan;
- управление порядком написания кода;
- автоматическое добавление repository;
- запрет штатного OpenSpec Archive.

#### Критерий готовности Change Layer

По одному `change-id` Core разрешает принятый Baseline и Binding, создаёт максимум
одно Assignment на repository и показывает полный aggregate status без ручного
переноса служебных идентификаторов.

### 4.4. Assignment/Implementation Layer

#### Каноническое имя

Используется термин **Assignment/Implementation Layer**. Короткое имя — Implementation
Layer.

Термин `Application Layer` или «слой применения» не используется, потому что его
легко спутать с OpenSpec Apply и с application layer прикладной архитектуры.

#### Назначение Assignment/Implementation Layer

Слой отвечает за выполнение части Change в одном конкретном repository. Он связывает
принятый общий план с локальной работой, но не копирует содержательный план в Core.

Он отвечает на вопросы:

- какое Assignment соответствует текущему repository;
- на каком Change и Baseline оно основано;
- какие точные Store и code revisions должен видеть исполнитель;
- какой Template handoff используется;
- какой структурированный результат вернулся;
- является ли результат актуальным для composite verification.

#### Входы Assignment/Implementation Layer

- явный `change-id`;
- принятые Change Binding и Planning Baseline;
- repository, однозначно определённый по current working directory или явному
  filter;
- Assignment identity;
- актуальный `openspec-orch.yaml`, user context и Template handoff;
- фактические Store/code revisions;
- для `record` — Result Receipt или структурированный ввод для его создания.

#### Выходы Assignment/Implementation Layer

- точный Implementation Context;
- вызов того handoff, который выбрал проект;
- честно атрибутированный Result Receipt;
- связь Receipt с точной repository revision;
- состояние `missing|recorded|failed|stale` как вычисленный факт, а не как
  ручной task status;
- точная revision для включения в Change Snapshot.

#### Lifecycle Assignment/Implementation Layer

```text
implement(change-id, repository)
    → resolve Assignment and Baseline
    → build Implementation Context
    → invoke Template handoff
    → agent/human changes code and runs checks outside Core
    → record(change-id, Result Receipt)
    → validate identity and exact revision
    → expose result to status/verify
```

`implement` можно повторять для одного Assignment: агент может перестроить
локальный план после изменения кода. Прежний Receipt остаётся достоверным
только для своей revision. Новая revision незаметно не «переносит» на себя старый
результат.

#### Публичные команды Assignment/Implementation Layer

| Команда | Обязательный вход | Результат | Чего не делает |
|---|---|---|---|
| `implement(change-id, repository?)` | Change ID; repository должен разрешиться однозначно | Точный context и вызов implementation handoff | Не генерирует и не кеширует содержательный plan |
| `record(change-id, result receipt)` | Change ID и Receipt для одного Assignment | Проверенный и сохранённый local result на точной revision | Не выдаёт заявленные checks за независимо повторенные Core |

##### `implement(change-id, repository?)`

1. Перечитывает config и перепроверяет Repository Layer.
2. Разрешает Change, accepted Baseline и Assignment.
3. Определяет current repository; при неоднозначности требует явный filter.
4. Сверяет optional assertions, например `expected-baseline`; assertion не меняет
   выбранную identity.
5. Формирует Implementation Context и добавляет user context, не позволяя ему
   переопределить runtime facts.
6. Вызывает `agent.handoffs.implement`.
7. В human и JSON output показывает Assignment, Baseline, repository revision и как
   должен быть передан или записан Receipt.

Отсутствующий handoff — lazy error только для `implement`; он не делает весь
Repository или Change Layer неработоспособным.

##### `record(change-id, result receipt)`

1. Проверяет versioned структуру Receipt.
2. Требует точного совпадения Change, Baseline, repository и Assignment.
3. Проверяет, что заявленная repository revision существует и относится к
   нужному checkout.
4. Сохраняет источник result и Evidence без приписывания им большей силы.
5. Сохраняет результат в machine-local state и делает его видимым для
   `status(change-id)`.

`record` может быть вызван Template handoff, агентом, человеком или будущим CI adapter.
В v1 все эти источники пишут в один локальный contract; сервер и командный
transport не добавляются.

#### Assignment identity

```text
Assignment = Change + Baseline + Repository
```

Один Change создаёт не более одного Assignment на repository для одного Baseline.
Внутренние Tasks и Work Packages принадлежат принятому плану и не становятся
Assignment identities Core.

Один Assignment может иметь несколько итераций реализации. Core хранит последний
валидный Result Receipt на точной revision, а не полную историю размышлений агента.

#### Implementation Context

Core формирует только технический Implementation Context:

- Change ID;
- Baseline;
- Store identity, root и revision;
- repository identity, root и revision;
- Assignment identity;
- config digest или revision;
- разрешённые read/write roots;
- security boundaries;
- ссылки на доступный OpenSpec context;
- выбранный Template handoff.

Core не генерирует и не кеширует содержательный implementation plan. Template и агент
читают произвольные planning-артефакты и строят актуальный локальный план на основе
текущего checkout.

#### Handoff

Handoff соединяет структурированные технические факты Core и agent-facing процесс
Template.

Целевой порядок:

```text
resolve Assignment
    → build Implementation Context
    → merge user context without overriding runtime facts
    → invoke Template handoff
    → agent/human implements outside Core
    → record Result Receipt
```

Template может заменить `/opsx-*` своим command, Superpowers, другим skill set или
процессом конкретной команды. Core проверяет наличие и безопасный путь handoff, но не
интерпретирует его содержимое.

#### Result Receipt

Result Receipt — небольшой versioned schema-neutral результат одного Assignment.

Минимальный contract должен включать:

- contract version;
- Change ID;
- Baseline;
- repository ID;
- Assignment ID;
- реализованную repository revision;
- result status;
- источник результата;
- заявленные checks или Evidence;
- техническую metadata для диагностики актуальности.

Core выполняет:

1. structural validation, например через Zod;
2. consistency validation Change, Baseline, repository и Assignment;
3. проверку доступных универсальных Git/OpenSpec facts;
4. проверку актуальности относительно используемого Snapshot.

Core не притворяется, что повторно выполнил project-specific commands. Результат
агента, человека или CI должен сохранять честный источник.

#### Зависимости между Assignments

Межрепозиторная зависимость не блокирует начало реализации автоматически. Принятый
план может разрешать параллельную работу, mocks или разработку по согласованному
контракту.

Core учитывает зависимость только в собственных verification gates: результат нельзя
назвать verified, если требуемый связанный Receipt или Evidence отсутствует либо
относится к другой revision.

#### Не входит в Implementation Layer

- интерпретация Core произвольного плана;
- обязательные Work Package IDs;
- предположение о наличии Tasks в Schema;
- скрытый active Change;
- автоматические external writes;
- серверная синхронизация Receipts;
- изменение OpenSpec Archive state.

#### Критерий готовности Assignment/Implementation Layer

В каждом repository пользователь передаёт один `change-id`; Core определяет
Assignment и Baseline, формирует точный context, вызывает Template handoff, принимает
валидный Receipt и включает точную implementation revision в общий Snapshot.

### 4.5. Composite verification

`verify(change-id)` является Change-level entrypoint, но агрегирует результаты
Assignment/Implementation Layer.

Core:

1. разрешает тот же Change и принятый Baseline;
2. проверяет наличие актуального Result Receipt для каждого repository из Binding;
3. собирает Snapshot точных implementation revisions;
4. проверяет универсальные orchestration gates;
5. передаёт Snapshot project-specific проверке через Template, агента или человека;
6. принимает простой результат `pass|fail`, источник и тот же Snapshot;
7. сохраняет результат в local state.

В v1 не вводятся отдельные сложные Composite Verification Context и Composite
Verification Receipt. Core не выполняет внутри себя все возможные project-specific
checks.

### 4.6. Сквозные инварианты

1. Каждая Change-level и implementation operation получает явный `change-id`.
2. Core не выбирает Change из истории предыдущего вызова.
3. Core не ветвится по имени OpenSpec Schema.
4. Обнаруженное состояние не становится принятым Binding без согласования.
5. Baseline и repository revisions всегда отражаются в машинном результате.
6. Изменение config, Binding или Baseline не переносит Receipt молча.
7. `openspec-orch.yaml` является desired state пользователя.
8. `.openspec-orch/state.json` является local observed state Core.
9. Template остаётся декларативным.
10. Core применяет gates только к собственным lifecycle states.
11. Local state одного инженера не выдаётся за общий командный state.
12. Новая подсистема добавляется только после измеримой повторяющейся проблемы.

`explore`, `plan` и `verify` не образуют дополнительные orchestration layers. Это
операции или handoffs, использующие объекты одного или нескольких трёх слоёв.

## 5. Доменная модель v1

### 5.1. Store

Store — OpenSpec-owned Git repository или root с нормативными Specs, Changes и
schemas. В v1 он одновременно является orchestration root.

Store не владеет:

- глобальным списком проектов пользователя;
- локальными путями checkout;
- credentials;
- task tracker;
- техническими зависимостями всей организации.

### 5.2. Repository Reference

Repository Reference — стабильная запись в `openspec-orch.yaml`:

- `repository_id`;
- role `store|code`;
- canonical remote URL;
- default branch.

Machine-local path не хранится в Git-tracked config. Core не требует жёстких
бизнесовых ролей `frontend`, `backend` или `infrastructure`.

### 5.3. Planning Baseline

Planning Baseline — точная принятая Git revision Store, на которой согласованы
planning-артефакты и Change Binding.

Baseline не равен автоматически текущему `HEAD` и не выбирается пользователем как
произвольная старая revision для удобства.

### 5.4. Change Binding

Change Binding — минимальная принятая связь Change со списком repository IDs.

Он является техническим выражением Planning Scope, но не дублирует план. Из Binding и
Baseline Core выводит Assignments.

Физическое место хранения и точный schema contract Binding должны быть определены в
implementation plan. Обязательное свойство: Binding принимается вместе с planning
state на одном Baseline и доступен Core без знания конкретных artifact names.

### 5.5. Assignment

Assignment — техническая identity `Change + Baseline + Repository`.

Assignment не является task, Work Package, веткой или отдельным planning document.
Они могут быть связаны с Assignment через Template, но не определяют её identity.

### 5.6. Implementation Context

Implementation Context — неизменяемый набор runtime facts одного вызова. Он
пересобирается из актуального config, Git/OpenSpec state и Assignment.

Содержательный plan в него не копируется. Ссылки на OpenSpec context допускаются,
если Core получил их из публичного структурированного ответа и проверил безопасные
границы.

### 5.7. Handoff

Handoff — передача Implementation Context в Template entrypoint.

Handoff должен иметь структурированную основу. Длинный prompt может быть частью
agent-facing представления, но не является единственным техническим контрактом.

### 5.8. Result Receipt

Result Receipt — структурированный результат Assignment, связанный с точной code
revision. В local-first v1 он хранится локально до composite verification.

Потеря Receipt требует повторно получить недоказуемые проверки, но не должна
повреждать Store или Code Repository.

### 5.9. Snapshot

Snapshot — точный набор revisions, использованный для composite verification:

- Change ID;
- Planning Baseline;
- config digest/revision;
- repository ID и implementation revision каждого Assignment;
- при необходимости clean/dirty и другие признаки воспроизводимости;
- source и время формирования.

В v1 Snapshot является runtime/state object Core, а не новым обязательным
Git-tracked planning artifact.

### 5.10. Evidence

Evidence — утверждение о проверке с явным источником и объектом проверки.

Минимальные требования:

- что проверялось;
- на какой revision или Snapshot;
- кем или какой системой;
- какой получен результат.

Текст «тесты прошли» без revision и источника не является достаточным Evidence.

### 5.11. Gate

Gate — условие перехода внутри слоя, который этим переходом владеет.

Core gate может запретить Orchestrator считать Assignment или Snapshot verified, но
не получает права запрещать OpenSpec Archive. Если пользователь сознательно обходит
orchestration flow, Core показывает последний gate как `missing`, `failed` или
`stale` и объясняет причину.

Точный enum lifecycle states и gates должен быть определён implementation plan, а не
додуман из названий текущих CLI-команд.

## 6. Конфигурация и состояние

### 6.1. Два независимых конфигурационных файла

В проекте остаются два файла с разными владельцами:

1. `openspec/config.yaml` — конфигурация OpenSpec, Schema и context OpenSpec.
2. `openspec-orch.yaml` — конфигурация Orchestrator, repositories, agent mapping,
   handoffs и общий agent-facing context.

Orchestrator не объединяет их в один формат и не вмешивается в Schema. Template может
поставить начальные версии обоих файлов, после чего пользователь свободно редактирует
их без повторного `init` или `adopt`.

### 6.2. Целевой минимальный `openspec-orch.yaml`

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
    plan: .qwen/commands/project-plan.md
    implement: .qwen/commands/project-implement.md
    verify: .qwen/commands/project-verify.md

repositories: []
```

Это целевой контракт, а не описание уже полностью работающего parser.

В текущем коде `version` и `context` ещё не являются полноценными нормализованными
полями: loose schema может их принять, но Core не использует их как целевой runtime
contract. Это разрыв реализации, который должен быть устранён до v1.

### 6.3. Правила config

- `openspec-orch.yaml` принадлежит пользователю;
- все поддерживаемые поля можно менять вручную и review через Git;
- `init` или `adopt` создают только стартовое значение Orchestrator config;
- `connect` не переписывает config;
- каждая операция заново читает и валидирует файл;
- один запущенный вызов фиксирует прочитанный config digest/revision;
- неизвестная версия должна давать явную compatibility error;
- поведение неизвестных полей должно быть определено до публикации;
- secrets и machine-local paths не сохраняются в файле;
- второй Orchestrator config в v1 не вводится.

### 6.4. Слияние контекста

При agent-facing вызове Core формирует итоговый контекст из двух источников:

1. user-owned `context` из актуального `openspec-orch.yaml`;
2. технические runtime facts Core.

Технические facts имеют приоритет. Пользовательский context не может переопределить:

- Change ID;
- Baseline;
- Store и repository identity;
- revisions;
- allowed roots;
- security boundaries;
- Assignment identity.

Operation-specific методология остаётся в Template handoff command/skill. Отдельный
operation-specific context в YAML добавляется только при подтверждённой проблеме.

### 6.5. Local observed state

Для v1 используется один Core-managed:

```text
.openspec-orch/state.json
```

Он:

- versioned;
- machine-local;
- не коммитится;
- записывается атомарно;
- валидируется при каждом чтении;
- хранит только то, что нельзя удобно передавать между вызовами иначе.

Минимальное содержимое:

- connection/workspace identity;
- Assignment identities;
- Result Receipts;
- gate results;
- composite verification result;
- связанные Baseline и repository revisions;
- config digest/revision;
- Snapshot.

Core перепроверяет ссылки по Git/OpenSpec. Несовпадение даёт `stale`. Повреждение или
потеря state не повреждает repositories: вычислимое состояние восстанавливается, а
недоказуемые checks выполняются повторно.

### 6.6. Изменение OpenSpec Schema в подключённом проекте

`openspec/config.yaml` и project-local schemas принадлежат OpenSpec-проекту. Их можно
редактировать через обычный Git/PR flow без повторного `init`, `adopt` или `connect`.
Core перечитывает актуальное OpenSpec-состояние при следующей операции и не пытается
мигрировать schema-defined artifacts самостоятельно.

Выбор Schema должен оставаться штатным поведением OpenSpec. В проверенной локально
версии OpenSpec 1.7.0 приоритет такой:

1. Schema, явно переданная операции OpenSpec;
2. Schema, записанная в metadata существующего Change;
3. Schema по умолчанию из `openspec/config.yaml`;
4. стандартная Schema `spec-driven`.

Поэтому смена default Schema влияет прежде всего на будущие Changes. Уже созданный
Change продолжает использовать Schema из своей metadata. Несовместимо изменять на
месте Schema, по которой существуют принятые активные Changes, опасно: прежние
артефакты могут перестать валидироваться или изменить смысл.

Безопасный путь для несовместимого изменения:

1. Создать новую identity Schema, например `team-flow-v2`.
2. Оставить старую Schema доступной до завершения активных Changes.
3. Сделать новую Schema default для новых Changes.
4. Мигрировать активный Change только явным решением владельца Change.

Если активный Change всё же переносится, необходимо явно сменить Schema, обновить или
пересобрать planning artifacts штатными средствами OpenSpec/Template, пересмотреть
Binding, повторно принять planning state и получить новый Baseline. Старые
Assignments, Receipts и verification после этого становятся `stale`. Core сообщает
это, но не переписывает артефакты и не принимает продуктовые решения за пользователя.

Изменения context и совместимых инструкций Schema могут применяться сразу. Они также
не переписывают автоматически уже созданные артефакты.

### 6.7. Изменение Template и процесса после `init` или `adopt`

После выполнения `init` Template не является runtime dependency: скопированные файлы
становятся project-owned. После `adopt` существующие process assets также остаются
project-owned. Поэтому обычная кастомизация выполняется напрямую через Git/PR:

- редактируются commands, skills и инструкции;
- меняются OpenSpec config и schemas;
- меняются planning/implementation/verification handoffs;
- при смене путей обновляется `openspec-orch.yaml`.

Следующая операция Core перечитает config; повторный `init`, `adopt` или `connect` для
этого не нужен. Штатное обновление сгенерированных OpenSpec provider assets через
публичный `openspec update`, если оно применимо, не является обновлением Template.

Переход проекта на другой полный Template не выполняется повторным `init` и не
является автоматическим merge. Безопасный v1-процесс:

```text
prepare desired assets → review diff → select changes → apply in branch
→ update config/handoffs → validate → review and merge
```

Новый Template не получает права удалить или заменить существующие project-owned
assets. Автоматические `template plan/migrate` допустимы в будущем только при
подтверждённой повторяющейся потребности.

Изменение только локальной методики реализации обычно не требует нового Baseline.
Изменение planning semantics, Schema или принятого Binding требует нового Baseline.
Изменение verification gate делает прежний verification result `stale`.

## 7. Публичный API и управляющая семантика

### 7.1. API по слоям

Целевые группы операций:

```text
Repository Layer:
init(path, store, agent, template, repositories?)
adopt(path, store, agent, compatibility mapping?, repositories?)
connect(path?, repositories?)
repository status(repository filter?)
repository sync(repository selection, confirmation token?)
disconnect(repository filter?)

Change Layer:
plan(change-id)
assign(change-id, repository IDs, expected-baseline?)
status(change-id, repository filter?)
verify(change-id)

Assignment/Implementation Layer:
implement(change-id, optional repository filter/assertions)
record(change-id, result receipt)
```

Имена и назначение всех перечисленных операций входят в scope lock. Implementation
plan должен зафиксировать точную CLI-грамматику, имена флагов, stdin/file contract
для Receipt и JSON schemas. Это не меняет владельца и семантику операций.

`repository status` и `status(change-id)` — разные команды. Первая отвечает на
вопрос «готовы ли Store и checkouts», вторая — «готов ли конкретный
multi-repository Change». Одна не подменяет другую.

В этот API намеренно не включены команды, которыми владеют другие системы:

- создание, редактирование, sync и Archive Change остаются операциями OpenSpec;
- `openspec context/doctor/store doctor --json` — публичные diagnostics OpenSpec,
  которые Core может вызывать внутри `init/adopt/connect/status`;
- конкретные `/opsx-*`, Superpowers и project commands остаются точками входа
  Template и могут быть связаны с `plan`, `implement` и `verify` handoffs;
- команды Git, test runner, CI и PR flow выполняются агентом, человеком или
  будущим Plugin, а не становятся скрытыми Core-командами.

### 7.2. Явный Change ID

Любая операция, работающая с конкретным Change, каждый раз получает `change-id`.

Core не использует:

- скрытый active Change;
- «последний открытый Change»;
- историю предыдущей команды;
- эвристику по имени текущей ветки как единственный источник identity.

Если identity неоднозначна, Core возвращает error и требует явный параметр.

### 7.3. Warning и error

`warning` означает: операция технически возможна, но пользователь должен явно принять
описанный риск.

- interactive: выбор `continue|cancel`;
- default: `cancel`;
- non-interactive: первый вызов возвращает `needs_confirmation` без side effects;
- повторный вызов подтверждает конкретный warning code.

`error` означает: Core не может сформировать корректную операцию.

- продолжить нельзя;
- confirmation не обходит error;
- неоднозначная identity, отсутствующий обязательный Baseline и несовместимая версия
  config относятся к errors.

### 7.4. Human и JSON output

Human output должен:

- быть полным и читаемым;
- объяснять причины состояния;
- выделять текущий repository цветом или жирным с текстовым fallback;
- показывать Baseline и revisions;
- предлагать следующее допустимое действие.

JSON output должен:

- использовать versioned contract;
- содержать те же identities и состояния;
- помечать текущий repository через `is_current`;
- не зависеть от визуального форматирования;
- различать success, warning/needs_confirmation и error;
- быть достаточным для automation без разбора human text.

### 7.5. Повторный вызов и продолжение через несколько дней

Повторный вызов не доверяет local state без проверки. Core:

1. читает актуальный config;
2. валидирует local state;
3. перепроверяет Store, Change, Baseline и repository revisions;
4. помечает несовпадения `stale`;
5. показывает, что можно восстановить и что требуется повторить;
6. не переносит старое доказательство на новое состояние автоматически.

## 8. OpenSpec Schema и gates

### 8.1. Schema остаётся произвольной

Core не должен содержать условия вида:

```text
if schema == "spec-driven"
if artifact == "proposal"
if path == "tasks.md"
```

Для Core schema ID, artifact ID и artifact paths являются opaque values из публичного
OpenSpec response.

Допустимые Schema:

- с Proposal, Design и Tasks;
- без Tasks;
- с другими именами артефактов;
- с другим artifact graph;
- с дополнительными schema-defined gates.

Если агенту нужен другой способ чтения или создания артефактов, меняется Template.
Core не получает новое условие по имени Schema.

### 8.2. Что проверяет Core

Core проверяет только универсальные технические факты:

- ответ относится к ожидаемому Store и Change;
- root и paths безопасны;
- identities однозначны;
- Baseline и revisions существуют;
- Binding и Receipt согласованы;
- Snapshot воспроизводим в заявленных границах;
- нужный Template handoff объявлен;
- config/state contracts совместимы.

### 8.3. Gates разных владельцев

| Gate | Пример | Владелец исполнения |
|---|---|---|
| OpenSpec artifact gate | Schema разрешает следующий artifact | OpenSpec |
| Core orchestration gate | Все Receipts относятся к тому же Baseline | Core |
| Project-specific gate | Интеграционный тест прошёл | Template/агент/CI/человек |
| Governance gate | PR approved | Человек или будущая внешняя интеграция |

Schema может требовать verification artifact или approval, но сама по себе не
доказывает выполнение внешней команды. Core не забирает ответственность за gate,
который он не исполнил.

## 9. Целевой end-to-end сценарий

### 9.1. Инициализация нового проекта

1. Инженер создаёт или выбирает Store repository.
2. Запускает `openspec-orch init`.
3. Core подтверждает, что валидного OpenSpec root ещё нет.
4. Пользователь выбирает один Template и задаёт известный repository registry.
5. Template устанавливает OpenSpec config/schema и agent-facing assets.
6. Core создаёт начальный `openspec-orch.yaml`.
7. Тот же запуск подключает текущую машину и показывает Repository status.
8. Инженер может редактировать оба config-файла дальше вручную.

### 9.2. Планирование Change

1. Change создаётся штатным механизмом OpenSpec/Template; Core не забирает
   эту операцию у OpenSpec.
2. Инженер вызывает `plan(change-id)` или продолжает работу через существующую
   OpenSpec/Template точку входа.
3. При `plan` Core проверяет Change и передаёт schema-neutral context в planning
   handoff; формат artifacts остаётся непрозрачным для Core.
4. Пользователь или planning-agent формирует известный список repositories;
   агент может предложить изменение с объяснением.
5. Инженер вызывает `assign(change-id, repository IDs)`.
6. Core показывает принимаемые Change Binding и Baseline; пользователь
   подтверждает изменение scope или Baseline.
7. Core создаёт по одной Assignment identity на repository.
8. `status(change-id)` показывает готовность всего Change к реализации.

### 9.3. Реализация в repository

1. Инженер переходит в один Code Repository.
2. Вызывает `implement(change-id)`.
3. Core определяет Store и текущий repository.
4. Разрешает принятый Baseline и Assignment.
5. Формирует Implementation Context.
6. Перечитывает общий user context.
7. Вызывает Template handoff.
8. Агент строит локальный plan из актуального кода и OpenSpec artifacts.
9. Реализация и tests выполняются в Code Repository.
10. Результат фиксируется через `record(change-id, Result Receipt)` на точной
    revision.
11. Цикл повторяется для остальных repositories.

### 9.4. Проверка Change

1. `status(change-id)` показывает все Assignments.
2. Инженер вызывает `verify(change-id)`.
3. Core проверяет наличие актуальных Receipts и собирает Snapshot точных
   implementation revisions.
4. Template/агент/человек выполняет project-specific composite verification.
5. Core принимает `pass|fail`, источник и тот же Snapshot.
6. Status показывает последний gate и причины missing/failed/stale.
7. OpenSpec Archive остаётся отдельным действием своего владельца.

### 9.5. Возврат через несколько дней

1. Инженер снова вызывает `status(change-id)`.
2. Core перечитывает config и local state.
3. Перепроверяет Git/OpenSpec facts.
4. Выделяет текущий repository.
5. Показывает актуальные Assignments и stale данные.
6. Инженер продолжает работу без ручного восстановления служебных ID.

### 9.6. Подключение существующего OpenSpec-проекта

1. Инженер запускает `openspec-orch adopt` в существующем Store.
2. Core подтверждает валидный OpenSpec root; если его нет, команда ничего не меняет и
   предлагает `openspec-orch init`.
3. Core read-only исследует OpenSpec и agent-facing process.
4. Core строит внутренний adoption plan; отдельного шага пользователя нет.
5. Core сохраняет существующие Schema, config, Specs, Changes, commands и skills.
6. Создаются только `openspec-orch.yaml`, Core metadata и
   действительно отсутствующие bridge assets.
7. Существующие planning/implementation/verification commands связываются с handoffs.
8. Тот же запуск выполняет local connect и печатает итоговый отчёт: что сохранено,
   что добавлено, какие слои готовы и каких capabilities ещё не хватает.
9. Дальнейший Change flow одинаков для проектов, созданных через `init` и подключённых
   через `adopt`.

Если это центральный Store, Code Repositories не получают копии центральных Specs и
Changes. `connect` лишь проверяет их Git identity и связь со Store. Если repository
нужен небольшой указатель на центральный Store, Core может предложить точный diff,
но не коммитит и не пушит его автоматически.

Если у нескольких Code Repositories уже есть независимые OpenSpec Stores, v1 не
сливает их молча. Команда либо явно выбирает и мигрирует данные в один authoritative
Store, либо создаёт отдельный Orchestrator context для каждого Store. Единый Change
поверх нескольких Stores относится к будущей Project/multi-Store модели.

## 10. Состояние текущей реализации

Этот раздел описывает проверенное состояние кода на момент последнего аудита
документа. При дальнейшем изменении CLI его необходимо обновлять.

### 10.1. Реализовано и полезно

Текущий CLI содержит:

- `init`;
- `connect`;
- `explore`;
- `change`;
- `load`.

Полезная основа уже существует:

- безопасный Template planner/materializer;
- один базовый или один пользовательский Template;
- provider/agent mapping;
- `openspec_adapter` для `openspec init --tools`;
- lazy Template handoffs;
- Store registration и doctor;
- подключение Code Repositories;
- Git identity и path safety checks;
- exact Store worktree для implementation runtime;
- поддержка whole-change mode для Schema без адресуемых Tasks;
- structured OpenSpec JSON validation;
- strict и relaxed execution modes текущего прототипа.

### 10.2. Соответствие трём слоям

| Текущая функция | Целевой слой | Оценка |
|---|---|---|
| `init` | Repository | Хорошая основа создания нового проекта; не должен поглощать Adoption |
| `adopt` | Repository | Пока отсутствует |
| `connect` | Repository | Хорошая основа, но нет полного status/sync/disconnect lifecycle |
| `explore` | Template-driven cross-layer handoff | Не является отдельным Core layer и не обязателен для v1 flow |
| `change` | Change | Только работа с OpenSpec Change; нет Binding, Baseline coordination и aggregate status |
| `load` | Assignment/Implementation | Частичный прототип; требует слишком много ручных служебных параметров |
| `plan` / `assign` / Change `status` | Change | Целевые команды пока отсутствуют; текущий `change` не заменяет их контракты |
| `implement` / `record` / `verify` | Assignment/Implementation + Change verification | Целевой цикл пока отсутствует; `load` покрывает только часть подготовки context |

Проверенный локально OpenSpec 1.7.0 уже предоставляет публичный
`openspec store register <path> --id <id> --json` для регистрации существующего
здорового OpenSpec root. Следовательно, Core не нужно изобретать собственный Store
registry или вручную создавать Store metadata. Текущий Orchestrator пока не оборачивает
эту capability отдельной командой `adopt`.

### 10.3. Критические разрывы

Сейчас отсутствуют:

- отдельная публичная команда `adopt`;
- read-only preflight, запрещающий использовать `init` и `adopt` не по назначению;
- read-only adoption inspection, adoption plan и compatibility report;
- безопасное mapping существующего agent process без требования свободного
  agent-pack path;
- завершение первых `init/adopt` через local connect и Repository status;
- versioned config contract с реально используемыми `version` и `context`;
- schema-neutral `plan(change-id)` и planning handoff;
- Change Binding;
- автоматическое разрешение принятого Baseline для обычных Change operations;
- `assign(change-id, repository IDs)` как точка принятия Binding/Baseline;
- Assignment identity как отдельный Core contract;
- общий `status(change-id)`;
- целевой `implement(change-id)` UX;
- Result Receipt;
- `.openspec-orch/state.json`;
- Snapshot всего multi-repository Change;
- `record` и `verify`;
- продолжение через несколько сессий на проверенном state;
- distribution contract и clean-install pilot.

Текущий `load` требует явно передавать Store, repository, Change, иногда Baseline и
Work Package IDs. Целевая модель должна выводить технические identities из
`change-id`, Binding, Baseline и текущего repository.

Текущий `openspec-orch.yaml` parser использует loose schema и не нормализует целевые
`version` и `context`. Поэтому наличие этих полей в YAML пока не означает, что Core
использует их по описанному здесь контракту.

Текущий `init` умеет работать в непустом Git repository и безопасно блокирует
различающиеся Template files. Он уже является основой операции создания нового
проекта и не должен разрастаться до подключения существующего процесса. Перед
запуском OpenSpec он требует, чтобы рассчитанные generated и target agent-pack
directories не существовали. Поэтому проект с уже установленными commands/skills
сейчас нельзя считать поддержанным `adopt`-сценарием.

Кроме того, текущий CLI требует явные `--store` и `--agent`, а после завершения лишь
печатает подсказку отдельно вызвать `connect`. Целевые interactive `init/adopt` могут
запрашивать только недостающие значения и сами выполнять первый local connect. Для
automation identities по-прежнему передаются флагами; `--mode` не появляется.

Если Store metadata уже существует, текущий код ожидает полностью завершённую
Orchestrator initialization и уходит в recovery/error при частичном состоянии. Он не
строит отдельный план подключения существующего OpenSpec Store. Template descriptor
может технически иметь пустой `copy`, но обязательные agent mappings и Bootstrap
последовательность сами по себе не образуют Compatibility contract.

Следовательно, Adoption реализуется отдельным public handler и preserve-first
plan/apply path. Он может переиспользовать безопасные низкоуровневые проверки `init`,
но не его Bootstrap preconditions и по умолчанию не вызывает повторный
`openspec init`.

Пакет имеет `private: true`, поэтому текущий checkout не является готовым публичным
npm-дистрибутивом.

### 10.4. Что не нужно сохранять только из-за существующего кода

Можно пересмотреть:

- названия `change` и `load`;
- обязательность ticket в Core;
- ручные `store/repo/baseline/work-package` параметры `load`;
- текущий порядок пользовательских шагов;
- привязку Explore к конкретной slash-команде;
- текущие enum и названия strict/relaxed policy, если новый implementation plan
  предложит более ясную совместимую модель.

Нельзя пересматривать без явного изменения этого scope lock:

- schema neutrality;
- границы Core/Template/OpenSpec;
- явный Change ID;
- accepted Binding и Baseline;
- отсутствие скрытого active Change;
- local-first v1;
- warning/error semantics;
- один config и один local state;
- отказ от Plugin/Graph/server scope в v1;
- публичные identities команд по трём слоям из раздела 7.1;
- отдельные `init` и `adopt`, их fail-closed preflight и preserve-first семантику
  Adoption.

## 11. План реализации

Старый архитектурный план перемещён в `docs/archive/` и не должен использоваться для
реализации. Нужен новый implementation plan, построенный по трём слоям.

### Этап 0. Публичные контракты и migration

Зафиксировать:

- schema/version `openspec-orch.yaml`;
- migration текущего config;
- schema/version `.openspec-orch/state.json`;
- физическое хранение Change Binding;
- способ разрешения accepted Baseline;
- Assignment identity;
- Implementation Context;
- Result Receipt;
- Snapshot;
- JSON contracts plan/assign/status/implement/record/verify;
- warning/error/confirmation protocol;
- compatibility с текущими handoffs;
- public contracts всех команд из раздела 7.1;
- fail-closed preflight contract для неверно выбранной команды;
- adoption inspection/plan/report contracts;
- судьбу `explore`, `change` и `load`.

Критерий выхода: разработчик может реализовывать contracts без додумывания
продуктовых identities и владельцев.

### Этап 1. Repository Layer

1. Сохранить и покрыть characterization tests текущих Bootstrap-путей `init/connect`.
2. Ограничить `init` созданием нового проекта через полный Template.
3. Добавить отдельную публичную команду `adopt` для существующего OpenSpec-проекта.
4. Реализовать общий read-only preflight: `init` блокируется при существующем
   OpenSpec root, а `adopt` — при его отсутствии.
5. В `adopt` разрешать exact root через публичные `openspec context/doctor --json` и
   блокировать declared/global-default root вместо target.
6. Переиспользовать существующую Store identity либо вызывать публичный
   `openspec store register`; не использовать `store setup` для Adoption.
7. Реализовать adoption plan, confirmation, idempotent recovery и compatibility
   report.
8. Реализовать Compatibility mapping к существующим commands/skills без overwrite и
   без обязательного повторного `openspec init`.
9. Завершать успешные `init/adopt` local connect и Repository status текущей машины.
10. Добавить version/context config contract.
11. Ввести local observed state foundation.
12. Добавить read-only repository status.
13. Добавить safe sync с warning/error semantics.
14. Определить повторный connect после ручного изменения config.
15. Реализовать disconnect после основного вертикального slice либо явно оставить его
   следующим небольшим increment.

Критерий выхода: новый проект можно создать через полный Template, существующий
OpenSpec-проект можно подключить без потери его assets, а workspace в обоих случаях
можно безопасно восстановить и диагностировать между сессиями.

### Этап 2. Change Layer

1. Реализовать schema-neutral planning context и optional `plan(change-id)` handoff.
2. Реализовать `assign(change-id, repository IDs)` как единственную точку
   принятия Change Binding и Planning Baseline Core.
3. Разрешать accepted Baseline автоматически.
4. Создавать детерминированные Assignment identities.
5. Реализовать aggregate `status(change-id)`.
6. Добавить stale detection при изменении Binding/Baseline/config.
7. Сохранить OpenSpec Schema opaque.

Критерий выхода: один Change виден как единая координационная единица по всем
repositories.

### Этап 3. Assignment/Implementation Layer

1. Реализовать `implement(change-id)`.
2. Автоматически определять текущий repository.
3. Формировать Implementation Context.
4. Добавлять общий user context без изменения runtime facts.
5. Вызывать Template handoff.
6. Реализовать Result Receipt и `record`.
7. Сохранять и перепроверять local state.
8. После появления Receipts завершить Change-level `verify(change-id)`: Snapshot,
   universal gates и verification handoff.

Критерий выхода: реализация в каждом repository требует только Change identity, а
общий результат проверяется на точном Snapshot.

### Этап 4. Вертикальный пилот

Пройти один реальный Change через два или три repositories:

```text
connect → plan → assign → status → implement → record → verify
```

Пилот обязан доказать:

- `init` в чистом проекте;
- `adopt` в проекте с собственной Schema и существующими agent commands;
- отсутствие изменений существующих OpenSpec/agent assets без явного выбора
  пользователя;
- отсутствие ручного переноса Baseline и Work Package IDs;
- корректное определение Assignment после смены repository;
- восстановление после перезапуска;
- понятный aggregate status;
- custom Schema без изменения Core;
- пользовательский Template со своими commands/skills;
- exact-revision composite verification.

Unit/integration tests и package dry-run не заменяют этот пилот.

### Этап 5. Distribution gate

До распространения в разные команды необходимо:

- определить package name, visibility и release process;
- убрать или осознанно заменить `private: true`;
- проверить установку в чистом окружении;
- проверить package contents;
- зафиксировать поддерживаемые Node/OpenSpec versions и capabilities;
- документировать config/state migration;
- предоставить минимальный Template example;
- проверить не менее двух разных Templates;
- проверить Compatibility mapping для существующего командного процесса;
- проверить Adoption Store с активным Change без миграции его Schema;
- проверить custom Schema без стандартных Tasks;
- документировать install, update, doctor и removal;
- исключить secrets и machine-local paths из Git-tracked artifacts;
- выполнить внешний pilot, а не только тесты текущего checkout.

После этого разные команды могут независимо использовать один Core со своими
Templates. Совместный transport local state между инженерами остаётся отдельным
последующим этапом.

## 12. Расширение только по наблюдаемому триггеру

| Наблюдаемая повторяющаяся проблема | Допустимое следующее расширение |
|---|---|
| Общий `context` регулярно создаёт конфликтующие инструкции | Operation-specific context |
| Одного handoff mapping недостаточно для реально поддерживаемых runtimes | Обобщённый entrypoint/adapter contract |
| Команды постоянно вручную совмещают несколько Templates | Template Recipe/Composer |
| Пользователь регулярно не знает участвующие repositories | Repository Graph/discovery |
| Ручное чтение CI/PR status стало постоянной потерей времени | Один read-only Plugin |
| Receipts необходимо передавать между инженерами | Git transport командного state |
| Один Store перестал описывать orchestration boundary | Project/multi-Store model |
| Git и локальное вычисление не справляются с общим статусом | Оценка индексатора или Control Plane |

До появления соответствующего наблюдения расширение не входит в backlog v1.

Если в будущем появится Repository Graph, он не должен смешиваться с OpenSpec
Artifact Graph: первый описывает отношения repositories, второй — зависимости
schema-defined artifacts одного Change.

## 13. Основные риски

### 13.1. Скрытая зависимость от конкретной Schema

Риск: Core снова начнёт ожидать Proposal, Tasks или фиксированные paths.

Защита: contract tests с custom Schema и whole-change mode; динамические paths только
из OpenSpec JSON.

### 13.2. Неоднозначный accepted Baseline

Риск: Core возьмёт текущий `HEAD` или старую revision без доказательства принятия.

Защита: отдельный Baseline resolution contract, явный output и fail-closed при
неоднозначности.

### 13.3. Дублирование плана в Core

Риск: Assignment или state превратятся во второй task tracker.

Защита: Assignment содержит только identity; Tasks и порядок остаются в
OpenSpec/Template planning artifacts.

### 13.4. Ложное Evidence

Риск: агент сообщает «тесты прошли», а status представляет это как независимо
проверенный факт.

Защита: обязательный source, revision/Snapshot и различение reported от independently
verified.

### 13.5. Устаревший local state

Риск: старый Receipt применяется к новому Baseline, config или code revision.

Защита: versioned state, consistency checks, config digest и явный `stale`.

### 13.6. Template захватывает Core lifecycle

Риск: скрытый Template hook выполняет сеть, Git write или внешнее изменение.

Защита: Template остаётся набором файлов и handoff mappings; executable integration
откладывается до отдельного доверенного protocol.

### 13.7. Распространение путают с командным state

Риск: local-first продукт объявляют готовым к совместной работе нескольких людей.

Защита: distribution gate подтверждает независимое использование командами; transport
Receipts требует отдельного решения и пилота.

### 13.8. Преждевременное расширение

Риск: Graph, Plugins, Composer и сервер реализуются до доказательства основного flow.

Защита: раздел 12 является обязательным scope gate для новых подсистем.

### 13.9. Adoption незаметно заменяет процесс команды

Риск: ради подключения Core повторно запускается Bootstrap, заменяется Schema,
provider pack или существующие commands/skills, и команда получает непредсказуемый
гибрид двух процессов.

Защита: `init` и `adopt` являются разными командами. Read-only preflight не разрешает
`init` работать с существующим OpenSpec root, а `adopt` всегда использует
preserve-first plan. Затем применяются confirmation для warnings и fail-closed
конфликты файлов.

### 13.10. Бесконечная совместимость раздувает Core

Риск: Core начнёт понимать каждую командную методологию, формат плана и CI-систему.

Защита: фиксированный Compatibility contract из handoffs, runtime context, Receipt и
Snapshot. Преобразование конкретного процесса остаётся в тонком project-owned bridge
или будущем Plugin, а не в ветвлениях Core.

## 14. Источники идей и границы заимствования

Концепция использует идеи существующих инструментов, но не копирует их целиком:

- **OpenSpec** — Change, Schema, artifact lifecycle и project-local configuration;
- **Git и worktrees** — exact revisions и изолированный runtime;
- **Nx affected / project graph** — только возможная будущая идея dependency
  discovery, не требование v1;
- **Bazel/Pants** — принцип воспроизводимых входов, а не build engine Orchestrator;
- **Dev Containers и workspace manifests** — идея воспроизводимой подготовки
  окружения, без обязательного контейнерного runtime;
- **CI matrix** — агрегация результатов нескольких компонентов на одном наборе
  revisions;
- **plugin architectures** — будущая явная capability boundary вместо скрытых hooks;
- **agent skills и command packs** — заменяемая методология поверх стабильного Core.

Главное заимствование из OpenSpec — разделение engine и project-local customization.
Orchestrator расширяет этот принцип на multi-repository coordination, не вмешиваясь в
работу Schema.

## 15. Финальный scope lock

OpenSpec Orchestrator v1 считается концептуально определённым следующим образом:

1. Первый пользователь — один продуктовый инженер.
2. Пользователь заранее знает основной список repositories.
3. `openspec-orch init` создаёт новый OpenSpec-проект через один полный Template.
4. `openspec-orch adopt` подключает существующий OpenSpec-проект по preserve-first
   правилам; `--mode` не используется.
5. Один OpenSpec Store является orchestration root.
6. OpenSpec владеет Change и Schema.
7. Core координирует repositories, Binding, Baseline, Assignments, Receipts и
   Snapshot.
8. Template владеет процессом команды, commands, skills и custom Schema.
9. Adoption сохраняет существующий процесс и связывает его с минимальным Core
   Compatibility contract; Core не устанавливает команде новую методологию.
10. Core не хранит содержательный implementation plan.
11. Существуют три слоя с фиксированными публичными операциями:
    Repository — `init`, `adopt`, `connect`, `repository status`, `repository sync`,
    `disconnect`; Change — `plan`, `assign`, `status`, `verify`;
    Assignment/Implementation — `implement`, `record`.
12. Все Change operations получают явный `change-id`.
13. Baseline разрешается автоматически и всегда показывается.
14. Один Change создаёт максимум одно Assignment на repository для Baseline.
15. Пользовательский context живёт в одном `openspec-orch.yaml` и перечитывается при
    каждом agent-facing вызове.
16. Machine-local state хранится отдельно в `.openspec-orch/state.json`.
17. Warning требует выбора; error продолжить не позволяет.
18. Composite verification относится к точному Snapshot.
19. Core не блокирует OpenSpec Archive.
20. Schema и project-owned Template assets меняются без повторного `init` или `adopt`;
    Core не выполняет их автоматическую миграцию.
21. Успешные `init` и `adopt` завершают local connect текущей машины; отдельный
    `connect` остаётся для других машин и повторного подключения.
22. Первая версия local-first и не требует сервера.
23. Разные команды могут использовать свои Templates или существующий процесс поверх
    одного Core.
24. Командный transport Receipts не входит в v1.
25. Graph, Plugin runtime, Template Composer, multi-Store и Control Plane добавляются
    только по измеримому триггеру.

Следующий документ должен быть новым implementation plan этапов 0–5 раздела 11. Он
обязан сверяться с текущим кодом, определить точные schemas и migration, но не должен
расширять зафиксированный здесь продуктовый scope.
