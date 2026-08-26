# Командный процесс OpenSpec

Этот документ описывает два поддерживаемых сценария работы команды. В обоих
сценариях штатный OpenSpec владеет жизненным циклом Change, а Project Template и
Plugins только добавляют проверки и контекст:

1. **Standard OpenSpec + Graphs** — штатные Planning, Apply и Archive с OpenSpec
   Graph и опциональным repository-local CodeGraph, но без Change Tracking.
2. **OpenSpec + Graphs + Change Tracking** — тот же процесс с дополнительно
   зафиксированными Cycle, planning revision, Result Receipts и Snapshot.

ЗАПРЕЩЕНО считать отсутствие Change Tracking ошибкой Standard OpenSpec flow.
ЗАПРЕЩЕНО, наоборот, обходить существующий Cycle переходом в standard mode.

## Общая основа обоих сценариев

Единственный источник требований — центральный Store `sdd-specs/openspec`. Jira
является источником запроса, но принятые Requirements и Scenarios принадлежат
OpenSpec. Code Repositories только реализуют принятый Change и не содержат
собственные `openspec/changes`.

Штатные OpenSpec workflows остаются владельцами операций:

- Planning по project-local schema `base-v1` создаёт `intake.md`, `proposal.md`,
  Delta Specs, `design.md` и `tasks.md`;
- штатный OpenSpec Apply реализует принятые Tasks;
- `/opsx-archive <change-id>` синхронизирует Delta Specs с Master Specs и перемещает
  Change в архив.

Orchestrator, OpenSpec Graph, CodeGraph и Change Tracking ЗАПРЕЩЕНО использовать как
альтернативный источник требований или отдельную машину жизненного цикла Change.

### Роли

- **Владелец** подтверждает intent, scope, критерии успеха и продуктовые решения.
- **Аналитик** отвечает за Intake, Proposal, Specs и сквозную трассировку.
- **Разработчик** подтверждает реализуемость Design, Tasks и implementation evidence.
- **Тестировщик** подтверждает проверяемость Scenarios и verification evidence.
- **Лид** обязателен для breaking contract, security/compliance, миграции данных,
  нескольких доменов, изменения SLO и необратимого rollout.

Один человек может совмещать роли. Gate всегда является явным решением людей; skill,
subagent, Graph или Change Tracking не принимают Gate автоматически.

### Старт нового Change

Каждый новый Change начинается с согласованного Intent, но это не означает
обязательный повторный запуск `base-intent`. Intent считается уже переданным, если
пользователь явно принимает Daily Intent Brief, Jira Story или другой источник, где
определены изменение, Why Now, ожидаемое улучшение, критерии успеха и ограничения.
Если этих элементов нет, до создания Change используется `base-intent`.

`base-intent` — не artifact и не команда OpenSpec: он проводит фасилитацию, возвращает
Daily Intent Brief и ничего не записывает. В той же сессии агент передаёт его смысл в
Intake из диалога. В новой сессии пользователь передаёт сам Brief или доступное
содержание принятой Jira Story; одна ссылка или номер без доступного содержания
остаётся provenance, но не заменяет Intent.

```text
Intent уже согласован?
  ├─ нет → base-intent → Daily Intent Brief
  └─ да → принятый Brief / доступное содержание Jira Story
                         ↓
/openspec-base-intake <change-id>
  ├─ ready_for_proposal → Proposal
  ├─ explore_recommended → /opsx-explore → повторный Intake
  └─ blocked → решение владельца или нормативный источник
                         ↓
Specs → Design → Tasks → Apply → Archive
```

Intake сначала использует подтверждённые выводы Intent и другие уже переданные ответы,
а затем задаёт только первый отсутствующий или конфликтующий вопрос. Он не повторяет
Intent-сессию и не заставляет пользователя вручную переносить ответы.

### Planning artifacts

Полный Change включает:

- `intake.md` — подтверждённый исходный контекст и решение о следующем маршруте;
- `proposal.md` — зачем и что меняется;
- `specs/<capability>/spec.md` — наблюдаемое поведение и Scenarios;
- `design.md` — решения на уровне системных границ, публичных контрактов, рисков,
  миграции и rollback;
- `tasks.md` — проверяемый план реализации по затронутым Code Repositories.

`intake.md` является первым artifact `base-v1` и prerequisite для Proposal. Он
сохраняет источники, проблему, ожидаемый результат, предварительные границы,
ограничения, сценарии, взаимодействия, ошибки, проверку и открытые вопросы. Для
взаимодействия двух и более компонентов, внешней зависимости, асинхронного обмена или
значимых error/degraded веток он содержит PlantUML sequence diagram; иначе раздел
Interaction Diagram содержит краткое `Not applicable` с причиной.

После согласования Intent канонический вход в Change —
`/openspec-base-intake <change-id>`. Команда задаёт по одному адаптивному вопросу,
учитывает Intent и уже переданные ответы и сама собирает их в template `intake.md`;
участник команды не переносит ответы вручную. При повторном
запуске команда продолжает существующий содержательный Intake, а не начинает анкету
заново. Для нового Change она сначала получает выбранный пользователем kebab-case
`change-id`, затем создаёт его по schema `base-v1`.

Intake не является Requirement, Scenario, Design decision, ADR, принятым Repository
Impact или evidence реализации. После его завершения пользователь явно выбирает
`/opsx-explore`, переход к Proposal либо дополнительное уточнение. Агент не запускает
следующий маршрут автоматически. OpenSpec определяет завершённость artifact по
наличию файла, поэтому пустой или предварительно созданный `intake.md` запрещён.

При `explore_recommended` команда сохраняет в Intake точные исследуемые вопросы и
status `pending`. После `/opsx-explore` её запускают повторно: findings добавляются в
тот же Intake как `CONFIRMED`, `CONTRADICTED`, `UNKNOWN` или `MISSING`, после чего
Planning Route выбирается заново. Отдельный обязательный exploration artifact не
создаётся. Если требуется бизнес-решение или отсутствующий нормативный источник,
маршрут — `blocked`, а не Explore.

Proposal ОБЯЗАН содержать Repository Impact только для тех зарегистрированных
`repository-id`, где из-за Change планируется изменение кода, тестов, конфигурации или
документации. Design implementation map и repository sections Tasks ОБЯЗАНЫ
использовать тот же набор.

ЗАПРЕЩЕНО перечислять весь Repository registry, неизменяемые или review-only
репозитории, а также создавать строки `no-change`. Если проверка review-кандидата
подтвердила реальное изменение, Change ОБЯЗАН вернуться в Planning; только после этого
репозиторий добавляется в Repository Impact, Design и Tasks.

Specs не дробятся по репозиториям. Requirement и Scenario описывают наблюдаемое
поведение capability. Если поведение меняется, Proposal перечисляет каждую новую или
изменяемую capability, а Change содержит один Delta Spec на её существующем пути.
`skip_specs` разрешён только при отсутствии изменения наблюдаемого поведения.

Новый Scenario получает стабильный ID в заголовке:

```markdown
#### Scenario: Временная ошибка устранена — add-payment-retry-001
```

Формат — `<change-id>-<index>`: точный lowercase `change-id` и последовательно
увеличиваемый трёхзначный index. Существующий ID ЗАПРЕЩЕНО переименовывать или
переиспользовать, включая перенос Scenario в Master Spec и последующие Changes.
Retained Scenarios в `MODIFIED` сохраняют свои ID.

### Граница технических деталей

Intake, Proposal, Specs, Design, Tasks и Store context ЗАПРЕЩЕНО превращать в inventory
текущей реализации. В центральный Store нельзя переносить внутренние пути, symbols,
имена файлов, классов, функций, модулей, таблиц, библиотек, локальных config keys,
команд сборки или построчное code evidence.

Разрешено фиксировать наблюдаемое поведение, доменные правила, системные границы,
принятые публичные контракты и точные `repository-id`. Внутренняя реализация
определяется в Code Repository во время Apply.

### OpenSpec Graph

OpenSpec Graph — Store-only производная модель Specs, Changes, Code Repositories и
явно подтверждённых связей из `openspec/graph.yaml`. Он не читает внутренности Code
Repositories, не меняет OpenSpec artifacts и не является фоновым сервисом.

#### Что строится автоматически, а что хранится явно

При каждом `graph build` Plugin заново выводит из Store:

- Store и зарегистрированные Code Repositories;
- текущие Master Specs;
- активные и архивные Changes и Delta Specs;
- связи `Store → contains → Repository`;
- связи `Change → contains → Delta Spec`;
- связи `Change → affects → Master Spec`;
- связи `Delta Spec → changes → Master Spec` с операцией `ADDED`, `MODIFIED`,
  `REMOVED` или `RENAMED`.

В tracked-файле `openspec/graph.yaml` хранятся только связи, которые нельзя безопасно
вывести из структуры OpenSpec:

- `Master Spec → implemented_by → Repository` — постоянное место реализации
  capability;
- `Delta Spec → targets → Repository` — implementation scope только одного Change;
- `Master Spec → depends_on → Master Spec` и
  `Delta Spec → depends_on → Delta Spec`;
- `Repository → depends_on|calls|publishes_to → Repository`;
- `Repository → verifies → Master Spec`.

Каждая такая связь ОБЯЗАНА иметь точный Store-relative `path:line` evidence.
Совпадение имён, предполагаемая архитектура и ребро CodeGraph evidence не заменяют.
`targets` ЗАПРЕЩЕНО автоматически копировать в `implemented_by`: временный scope
Change не доказывает постоянного владельца реализации capability.

Tracked `openspec/graph.yaml` входит в обычный Git-процесс Store. Построенный индекс
Plugin является локальным производным состоянием, не коммитится и всегда может быть
воспроизведён через `graph build`. Перед построением Plugin запускает строгую
валидацию всего OpenSpec Store и заменяет последний успешный индекс атомарно только
после успешной проекции.

#### Главное правило запуска

Graph НИЧЕГО не запускает сам при изменении файлов, Planning, Apply, создании Cycle
или Archive. У Plugin нет watcher, фоновой пересборки и автоматического вызова из
штатных OpenSpec operations.

Фраза «агент обязан вызвать Graph» в этом документе означает, что агент сам явно
выполняет соответствующую команду перед продолжением текущего workflow. Пользователю
не нужно дублировать этот вызов. Если пользователь проходит flow без агента, те же
команды он выполняет вручную.

#### Однократное подключение

Решение установить Plugin и привязать его к Store принимает пользователь или
администратор Store:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph build
```

`plugin connect` только сохраняет binding. Он не запускает строгую OpenSpec validation
и потому допустим при незавершённом Intake/Proposal; до первого явного `graph build`
состояние Graph — `unavailable`. Пустой Store можно построить сразу; если уже существует
Intake-only или Proposal-only Change, build выполняется после валидных Delta Specs.

Агент ЗАПРЕЩЕНО молча устанавливать или подключать Plugin, менять Plugin declarations
или выбирать Store. Он может выполнить эти команды только по явному запросу
пользователя. После принятого подключения агент использует Graph как обязательную
проверку Planning и Archive без отдельного напоминания на каждом шаге.

#### Единый preflight агента

Перед `inspect`, `impact`, `check-scope` или `view` агент выполняет:

```bash
openspec-orch graph status --json
```

Дальнейшее действие определяется статусом:

- `ready` и `authoritative: true` — разрешено выполнять запрос;
- `stale` или `unavailable` с `next_command` — агент выполняет точную предложенную
  команду, повторяет status и продолжает только после `ready`;
- `invalid` — агент останавливает Graph-dependent шаг, диагностирует входные данные
  и возвращает blocker;
- Plugin не подключён — агент возвращает `not_configured` и останавливает обязательный
  Graph-dependent flow; пользователь решает подключить Plugin либо явно перейти на
  процесс, где Graph не требуется политикой проекта.

Last known-good используется только для диагностики. `inspect`, `impact`,
`check-scope` и `view` ЗАПРЕЩЕНО выполнять по несвежему индексу.

`source_digest` изменяют topology-входы: Store ID, `repository-id + role`, Master
Specs, Delta Specs, активное или архивное состояние Changes, `openspec/graph.yaml` и
файлы evidence явных связей. Обычное изменение кода в Code Repository, обновление
CodeGraph, текста Intake, Proposal, Design, Tasks или task checkbox само по себе Graph stale
не делает. Intake, Proposal, Design или Tasks попадают в digest только если конкретная строка
используется как evidence явной связи.

#### Что делает каждая команда

- `graph status --json` ничего не пересобирает и показывает freshness, признак
  authoritative, last known-good и точный `next_command` для recovery;
- `graph build` валидирует OpenSpec и перестраивает локальный индекс из текущих
  topology-входов;
- `graph inspect <node-id>` возвращает прямое окружение одного точного node ID без
  fuzzy-поиска;
- `graph impact <change-id>` возвращает directly changed и downstream Master Specs,
  implementation repositories, review-кандидатов и зависимости между Changes;
- `graph check-scope <change-id> --repo ...` сравнивает предложенный implementation
  scope с impact, но ничего не добавляет в Planning или Cycle;
- `graph view` запускает read-only локальный UI по тому же свежему индексу.

Все перечисленные `graph`-команды, кроме `build`, являются read-only. Успешный
`build` подтверждает структуру и provenance графа, но не доказывает истинность
архитектурного утверждения в explicit edge: за эту семантику отвечает человек,
принявший решение.

#### Planning до и после Delta Specs

До появления валидных Delta Specs используется preliminary phase:

- capability candidates берутся из принятого intent и Proposal;
- неизвестный capability path разрешается через `openspec list --specs --json`, после
  чего агент читает только точную существующую Master Spec;
- Graph recovery/build, `graph inspect`, `graph impact`, `graph check-scope` и
  объявление Cycle scope ЗАПРЕЩЕНЫ;
- `stale` или `unavailable` Graph не блокирует preliminary phase;
- Graph не используется для угадывания будущего repository scope.

После создания или изменения валидных Delta Specs агент ОБЯЗАН перейти в
authoritative phase:

```bash
openspec-orch graph build
openspec-orch graph status --json
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
```

Агент сопоставляет `direct_repositories` с Repository Impact, Design и Tasks.
`missing_required_repositories`, `missing_delta_specs` и `unmapped_master_specs` —
BLOCKER. `dependent_repositories` и `review_repositories` являются кандидатами для
адресной проверки и ЗАПРЕЩЕНЫ к автоматическому добавлению в implementation scope.
`publishes_to` описывает топологию event contract и сам по себе не добавляет
Repository в impact или review.

Перед Gate 1 агент вызывает `openspec-base-graph-maintenance` для КАЖДОЙ directly
changed Master Spec и сверяет её постоянные `implemented_by`. Если точное evidence
уже существует и изменение разрешено, агент добавляет минимальную связь в
`openspec/graph.yaml`, пересобирает Graph и повторяет проверки. Если владелец
реализации неоднозначен, агент ЗАПРЕЩЕНО угадывать связь: решение принимает Владелец
или назначенный архитектурный owner, после чего агент фиксирует подтверждённый
результат.

Для принятого `skip_specs` без Delta Specs `graph impact` и `graph check-scope`
помечаются как `not_applicable`; Repository Impact и Tasks sections проверяются
напрямую. Создавать фиктивную Delta Spec ЗАПРЕЩЕНО.

#### Apply и изменение scope

После Gate 1 Graph используется агентом как источник принятого repository scope и
контекста impact. Сам Plugin не выполняет checkout, не меняет код, не запускает
тесты, не вызывает CodeGraph и не отмечает Tasks.

Если во время Apply обнаружено, что нужен ещё один Repository или меняется другая
capability, агент останавливает реализацию и возвращает Change в Planning. После
обновления Delta Specs, Repository Impact, Design и Tasks он заново выполняет
`build`, `impact`, `check-scope`, сверку `implemented_by` и Gate 1. Добавлять
Repository только в Cycle или Tasks в обход Graph-проверки ЗАПРЕЩЕНО.

#### Участие в Change Tracking

Change Tracking не вызывает Graph и не вычисляет impact автоматически. Перед
`assign` агент ОБЯЗАН выполнить `graph check-scope` для точного принятого набора
repositories. Пользователь выбирает Standard Apply или создание Cycle, а также
подтверждает preview `assign`; Graph этого решения не принимает.

После создания Cycle изменение topology-входов Graph или repository scope требует
повторной Graph-проверки. Изменение Planning, нарушающее planning integrity, отдельно
инвалидирует Cycle по правилам Change Tracking.

#### Archive и post-Archive handoff

Пользователь принимает Gate 2, Gate 3 и решение об Archive. Агент может выполнить
`/opsx-archive <change-id>` только после такого разрешения; Graph не инициирует
Archive.

Перед Archive агент выполняет preflight, `impact`, проверку prerequisite Changes,
`check-scope` и повторную сверку `implemented_by`. После штатного Archive агент
ОБЯЗАН:

1. выполнить новый `graph build` и получить `ready`/`authoritative`;
2. прочитать `graph impact <change-id>` уже для архивного Change;
3. выполнить `graph inspect` каждой directly changed Master Spec;
4. подтвердить, что актуальные постоянные `implemented_by` сохранены.

Post-Archive failure не откатывает уже выполненный Archive, но Graph handoff остаётся
незавершённым до устранения ошибки.

#### Кто запускает команды

| Действие | Агент | Пользователь |
| --- | --- | --- |
| Установить и подключить Plugin | Только по явному запросу | Принимает решение и указывает Store |
| Проверить status и пересобрать stale index внутри Planning/Archive | Выполняет без отдельного напоминания | Выполняет сам, если работает без агента |
| Выполнить `inspect`, `impact`, `check-scope` | Выполняет на соответствующем этапе flow | Может запускать вручную для анализа |
| Изменить явную связь в `graph.yaml` | Делает минимальный edit только с evidence и разрешением | Подтверждает неоднозначную семантику и новую архитектурную связь |
| Создать или изменить Cycle | Не делает автоматически | Выбирает режим и подтверждает `assign` |
| Запустить Archive | Только после явного разрешения | Принимает Gate и решение об Archive |
| Запустить `graph view` | Только по запросу на демонстрацию или UI-проверку | Обычно запускает и останавливает локальный viewer сам |

#### Viewer и видимые связи

Пользователь запускает read-only интерфейс из корня Store:

```bash
openspec-orch graph view
```

Команда работает до `Ctrl-C` и принимает только свежий `ready` index. Агент запускает
долгоживущий viewer только по явному запросу пользователя либо когда UI-проверка
прямо входит в задачу.

По умолчанию видны три основных слоя: Repository, Master Spec и Change. Delta Specs
скрыты. Поэтому impact показывается короткой агрегированной связью
`Change → affects → Master Spec`, а постоянная связь
`Master Spec → implemented_by → Repository` остаётся видимой.

При включении слоя Delta Spec viewer для каждой раскрытой цепочки динамически скрывает
дублирующую `affects` и показывает подробный путь:

```text
Change → contains → Delta Spec → changes → Master Spec
                         └────── targets ──────→ Repository
Master Spec ───────── implemented_by ─────────→ Repository
```

Таким образом, `affects` не исчезает из модели: оно скрывается только тогда, когда тот
же impact уже виден через Delta Spec. `targets` отвечает за scope конкретного Change,
а `implemented_by` — за постоянную связь capability с Repository. Кнопка сброса
возвращает основные три слоя и снова показывает агрегированную `affects`.

### CodeGraph

CodeGraph — опциональный revision-sensitive индекс внутри конкретного Code
Repository. Он используется только для навигации по текущей реализации после того,
как сформулировано точное current-state утверждение, которое требуется подтвердить
или опровергнуть.

На Intake-, Proposal- и Specs-стадиях читать Code Repository или CodeGraph ЗАПРЕЩЕНО. На
Design-, Tasks- и Apply-стадиях разрешена адресная проверка только выбранного
Repository и только на подтверждённой Git revision. Если `.codegraph/` отсутствует,
индекс stale или недоступен, используется адресный read/search; отсутствие CodeGraph
не блокирует OpenSpec flow. Запускать `init` или `sync` автоматически ЗАПРЕЩЕНО.

CodeGraph evidence подтверждает только текущую реализацию или техническую возможность.
Его ЗАПРЕЩЕНО переносить в Store artifacts как технические детали или использовать
для переписывания принятого Requirement.

## Gate 1 — общий Planning Gate

Перед началом реализации ОБЯЗАТЕЛЬНЫ:

- Jira Story связана с `change-id` либо отсутствие Jira явно зафиксировано;
- OpenSpec Change проходит строгую валидацию;
- Intake завершён, его Planning Route разрешён и вопросы, меняющие scope или
  наблюдаемое поведение, закрыты;
- Proposal, Delta Specs, Design и Tasks согласованы между собой;
- OpenSpec Graph свежий, а repository scope проверен после Delta Specs;
- для каждой непосредственно изменяемой Master Spec подтверждена постоянная связь
  `implemented_by` с Repository, который остаётся местом реализации capability;
  Change-scoped `targets` НЕ ЗАМЕНЯЕТ эту связь;
- Repository Impact, Design и Tasks содержат одинаковый набор `repository-id` только
  для репозиториев с планируемыми изменениями;
- каждый новый или изменённый Scenario имеет план проверки;
- закрыты решения, меняющие scope, Specs, Design или Tasks;
- Владелец, Аналитик, Разработчик и Тестировщик приняли Planning; Лид подключён по
  риск-триггерам.

Результат Gate 1 относится к точной Git revision Planning. В Standard flow команда
фиксирует её своим обычным процессом. В Change Tracking flow она дополнительно
записывается в Cycle Record.

## Сценарий 1 — Standard OpenSpec + Graphs

Этот сценарий используется, когда Change Tracking не подключён или команда явно
выбрала Standard OpenSpec Apply после `CYCLE_NOT_FOUND`.

### Поток

1. Владелец и команда формируют intent, Intake и остальные Planning artifacts;
   после Intake явно выбирают Explore либо переход к Proposal.
2. OpenSpec Graph проверяет capability impact и согласованность Repository Impact.
3. Люди принимают Gate 1.
4. Разработчики запускают штатный OpenSpec Apply и реализуют принятые Tasks
   в соответствующих Code Repositories. CodeGraph может использоваться для адресной
   навигации по текущей реализации.
5. PR Review и repository-local CI проверяют код, тесты и соответствие принятому
   Change.
6. Команда своим действующим процессом фиксирует точные implementation commits,
   поставляемый artifact и результаты IFT/QA.
7. Люди принимают Gate 2 и Gate 3 на подтверждённом evidence.
8. Выполняются Release и штатный OpenSpec Archive.

### Что именно означает Standard Apply

Project skill `openspec-base-apply-context` сначала проверяет конфигурацию Plugins. Если
Change Tracking не подключён для текущего workflow, выбирается Standard OpenSpec
Apply без вызова его команд. Если Change Tracking подключён, skill выполняет
`openspec-orch status <change-id> --json`; только `CYCLE_NOT_FOUND` разрешает
предложить Standard OpenSpec Apply или создание Cycle. Пользователь ОБЯЗАН явно
выбрать режим; создавать Cycle автоматически ЗАПРЕЩЕНО.

Standard mode передаёт исходные OpenSpec contextFiles и Tasks встроенному Apply. Он не
предоставляет:

- машинный repository scope;
- planning pin;
- Cycle Record;
- Result Receipts;
- детерминированный multi-repository Snapshot;
- Verification Receipt.

Поэтому координация репозиториев, фиксация точных commits и привязка результатов
проверки выполняются действующим процессом команды. Называть такой ручной набор
версий `Change Tracking Snapshot` ЗАПРЕЩЕНО.

## Сценарий 2 — OpenSpec + Graphs + Change Tracking

Этот сценарий добавляет Change Tracking после принятого Gate 1. Он не заменяет ни
Planning, ни OpenSpec Graph, ни Apply, ни внешние проверки.

### Что добавляет Change Tracking

- Cycle Record с точным составом Code Repositories и Planning revision;
- repository-scoped Apply context;
- Result Receipt с точным implementation commit каждого Repository;
- детерминированный Snapshot полного набора completed Results;
- Verification Receipt последнего текущего Snapshot.

Перед `assign` набор `--repo` ОБЯЗАН совпадать с принятым Repository Impact и пройти
`graph check-scope`. Сам Change Tracking не вычисляет impact и не обращается к Graph
автоматически.

### Поток

1. После Gate 1 Store checkout ОБЯЗАН быть чистым, а Planning — закоммиченным.
2. Из Store создаётся Cycle:

   ```bash
   openspec-orch assign <change-id> --repo <repository-id>...
   ```

3. Пользователь проверяет preview. Созданный Cycle Record ОБЯЗАН быть закоммичен
   обычным Git-процессом; `assign` не выполняет commit или push.
4. При существующем Cycle штатный OpenSpec Apply работает только в orchestrated
   mode. Обход Cycle через Standard Apply ЗАПРЕЩЁН.
5. Apply ОБЯЗАН проверить planning integrity, свежий OpenSpec Graph и точный Cycle
   scope. В текущем Code Repository выполняются только Tasks section с его точным
   `repository-id`; общая section требует явного owner.
6. После завершения Tasks и получения существующего implementation commit записывается
   Result Receipt:

   ```bash
   openspec-orch record assignment <change-id> \
     --repo <repository-id> --commit <sha> \
     --status <completed|failed|blocked> --source <human|agent|ci>
   ```

7. Когда каждый Repository Cycle имеет текущий `completed` Receipt, вычисляется
   Snapshot:

   ```bash
   openspec-orch verify <change-id>
   ```

8. `verify` только проверяет полноту Receipts и вычисляет `snapshot_id`. Он не делает
   checkout, не запускает тесты и не подтверждает качество. IFT и QA ОБЯЗАНЫ быть
   выполнены внешним процессом именно на версиях Snapshot.
9. Результат внешней проверки записывается для последнего текущего Snapshot:

   ```bash
   openspec-orch record verification <change-id> \
     --result <pass|fail> --source <human|agent|ci>
   ```

10. `openspec-orch status <change-id>` ОБЯЗАН показать текущий Cycle, Results,
    Snapshot, Verification Receipt и следующее действие. После этого люди принимают
    соответствующие Gate и Release-решение.

### Planning integrity и инвалидация

- Изменение Intake, Proposal, Specs, Design, текста или порядка Tasks после создания Cycle —
  planning drift. Реализация блокируется, Change возвращается в Planning, Gate 1 и
  Cycle создаются заново.
- Переключение существующего Task checkbox при подтверждённом task-level evidence —
  progress-only и не создаёт новую planning revision.
- Изменение состава репозиториев требует нового Gate 1 и нового Cycle.
- Новый implementation commit делает предыдущий Result Receipt, Snapshot и связанную
  verification нетекущими; Gate 2, IFT, QA и Gate 3 должны относиться к новому
  кандидату.
- Blocked Task остаётся незакрытой и ЗАПРЕЩАЕТ `completed` Result Receipt текущего
  Repository.

### Ограничения Change Tracking v1

Change Tracking v1 рассчитан на одного пользователя и одну активную рабочую копию
Store на машине. Cycle Record хранится в Git, а Result Receipts, Snapshots и
Verification Receipts — только в локальном Plugin state и между машинами не
переносятся.

Change Tracking не выполняет Git checkout, тесты, IFT, QA, Release или Archive, не
публикует данные во внешние системы и не предоставляет отдельные `plan` или
`implement` operations.

## Gate 2 и Gate 3

В обоих сценариях Gate остаются решениями людей:

- **Gate 2 — Implementation candidate:** реализации прошли PR Review и обязательные
  repository checks; зафиксированы точные commits и поставляемый artifact; отклонения
  от OpenSpec отсутствуют или явно разрешены.
- **Gate 3 — Release ready:** IFT и QA выполнены на том же кандидате; Scenarios
  проверены; нет блокирующих дефектов; rollout, наблюдение и rollback подтверждены.

В Standard flow evidence и набор commits фиксируются действующим процессом команды. В
Change Tracking flow Gate 2 ОБЯЗАН ссылаться на текущий Snapshot, а результат внешней
проверки — на его текущий Verification Receipt. Change Tracking не принимает Gate и
не заменяет решение Владельца, Тестировщика или Лида.

## Archive и внешние интеграции

Archive разрешён только после завершения требуемых реализаций, ручной проверки и
Release по политике проекта. Штатный `/opsx-archive` остаётся владельцем синхронизации
Delta Specs и перемещения Change.

Перед Archive ОБЯЗАТЕЛЬНО:

1. получить свежий authoritative OpenSpec Graph;
2. выполнить `graph impact <change-id>` и проверить prerequisite Changes;
3. проверить repository scope через `graph check-scope`:
   - при существующем Cycle использовать точный набор его repositories;
   - при `CYCLE_NOT_FOUND` использовать только repository sections принятых Tasks,
     предусматривающие реальное изменение;
   - при принятом `skip_specs` пометить scope check как `not_applicable` и проверить
     repository sections напрямую;
4. устранить missing, unmapped и extra repositories;
5. review-кандидата добавить в scope только после подтверждения реального изменения и
   повторного Planning/Gate 1;
6. через `openspec-base-graph-maintenance` проверить КАЖДУЮ directly changed Master
   Spec: `targets` показывает scope этого Change, но НЕ ЯВЛЯЕТСЯ постоянным mapping.
   Подтверждённый Repository, который остаётся местом реализации capability, ОБЯЗАН
   иметь явную `Master Spec → implemented_by → Repository`. Временный target,
   review-only и no-change Repository добавлять ЗАПРЕЩЕНО. Неопределённый владелец
   реализации блокирует Archive handoff и требует решения владельца.

После Archive Graph ОБЯЗАН быть пересобран, потому что применение Delta Specs и
перемещение Change изменяют входы проекции. Затем агент ОБЯЗАН повторно выполнить
`graph impact` и `graph inspect` для каждой directly changed Master Spec и подтвердить
её постоянные `implemented_by`. Пока `graph status --json` не вернул `ready`, impact
архивного Change не прочитан и mapping не подтверждён, Graph handoff считается
незавершённым. Ошибка post-build не откатывает уже выполненный штатный Archive.

После успешного Graph handoff команда может выполнить необязательный context-promotion
audit:

```text
/openspec-base-context audit --change <change-id>
/openspec-base-context audit --spec <capability-path> [--spec <capability-path>...]
/openspec-base-context audit --domain <domain-path>
```

Selectors объединяются; точный Change через ready Graph добавляет directly changed
Master Specs, а `--spec` и `--domain` задают ручной или периодический scope. Агент сам
выбирает связанные файлы `openspec/context/` и проверяет ADR candidates. Master Spec
может подтвердить durable context, но ADR требует принятого Design, owner decision или
другого источника WHY и альтернатив. Audit ничего не записывает. Update показывает
точный diff и изменяет context/ADR только после отдельного подтверждения. Отсутствие
кандидатов, отложенное обновление или пропуск этого шага не блокируют Archive и не
изменяют Master Specs.

Jira, CI, Zephyr, Confluence и другие внешние системы остаются adapters команды и не
становятся источником требований. Если политика проекта требует публикацию архивной
копии, она должна быть идемпотентной и ссылаться на архивную Git revision Store. Сбой
внешней публикации не изменяет OpenSpec artifacts.

## Исключения

Для каждого исключения ОБЯЗАТЕЛЬНЫ причина, владелец решения, область, срок действия и
компенсирующая проверка. Неизвестный владелец или бессрочное исключение блокирует
соответствующий Gate.
