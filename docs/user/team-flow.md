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

- Planning создаёт `proposal.md`, Delta Specs, `design.md` и `tasks.md`;
- штатный OpenSpec Apply реализует принятые Tasks;
- `/opsx-archive <change-id>` синхронизирует Delta Specs с Master Specs и перемещает
  Change в архив.

Orchestrator, OpenSpec Graph, CodeGraph и Change Tracking ЗАПРЕЩЕНО использовать как
альтернативный источник требований или отдельную машину жизненного цикла Change.

### Роли

- **Владелец** подтверждает intent, scope, критерии успеха и продуктовые решения.
- **Аналитик** отвечает за Proposal, Specs и сквозную трассировку.
- **Разработчик** подтверждает реализуемость Design, Tasks и implementation evidence.
- **Тестировщик** подтверждает проверяемость Scenarios и verification evidence.
- **Лид** обязателен для breaking contract, security/compliance, миграции данных,
  нескольких доменов, изменения SLO и необратимого rollout.

Один человек может совмещать роли. Gate всегда является явным решением людей; skill,
subagent, Graph или Change Tracking не принимают Gate автоматически.

### Planning artifacts

Полный Change включает:

- `proposal.md` — зачем и что меняется;
- `specs/<capability>/spec.md` — наблюдаемое поведение и Scenarios;
- `design.md` — решения на уровне системных границ, публичных контрактов, рисков,
  миграции и rollback;
- `tasks.md` — проверяемый план реализации по затронутым Code Repositories.

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

Proposal, Specs, Design, Tasks и Store context ЗАПРЕЩЕНО превращать в inventory
текущей реализации. В центральный Store нельзя переносить внутренние пути, symbols,
имена файлов, классов, функций, модулей, таблиц, библиотек, локальных config keys,
команд сборки или построчное code evidence.

Разрешено фиксировать наблюдаемое поведение, доменные правила, системные границы,
принятые публичные контракты и точные `repository-id`. Внутренняя реализация
определяется в Code Repository во время Apply.

### OpenSpec Graph

OpenSpec Graph — Store-only производная модель Specs, Changes, Code Repositories и
явно подтверждённых связей из `openspec/graph.yaml`. Он не читает внутренности Code
Repositories и не меняет OpenSpec artifacts.

До появления Delta Specs используется только preliminary phase:

- capability candidates берутся из принятого intent и Proposal;
- для существующей capability разрешён точный `graph inspect`;
- `graph impact`, `graph check-scope` и объявление Cycle scope ЗАПРЕЩЕНЫ.

После валидных Delta Specs Graph ОБЯЗАН перейти в authoritative phase:

```bash
openspec-orch graph build
openspec-orch graph status --json
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
```

Продолжать разрешено только при `state: ready` и `authoritative: true`.
`missing_required_repositories`, `missing_delta_specs` и `unmapped_master_specs` —
BLOCKER. `dependent_repositories` и `review_repositories` являются кандидатами для
проверки и ЗАПРЕЩЕНЫ к автоматическому добавлению в implementation scope.
`publishes_to` описывает топологию event contract и сам по себе не добавляет
Repository в impact или review.

Для принятого `skip_specs` без Delta Specs `graph impact` и `graph check-scope`
помечаются как `not_applicable`; Repository Impact и Tasks sections проверяются
напрямую. Создавать фиктивную Delta Spec ЗАПРЕЩЕНО.

### CodeGraph

CodeGraph — опциональный revision-sensitive индекс внутри конкретного Code
Repository. Он используется только для навигации по текущей реализации после того,
как сформулировано точное current-state утверждение, которое требуется подтвердить
или опровергнуть.

На Proposal- и Specs-стадиях читать Code Repository или CodeGraph ЗАПРЕЩЕНО. На
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
- Proposal, Delta Specs, Design и Tasks согласованы между собой;
- OpenSpec Graph свежий, а repository scope проверен после Delta Specs;
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

1. Владелец и команда формируют intent и Planning artifacts.
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

- Изменение Proposal, Specs, Design, текста или порядка Tasks после создания Cycle —
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
   повторного Planning/Gate 1.

После Archive Graph ОБЯЗАН быть пересобран, потому что применение Delta Specs и
перемещение Change изменяют входы проекции. Пока `graph status --json` не вернул
`ready` и `graph impact` не прочитан для архивного Change, Graph handoff считается
незавершённым. Ошибка post-build не откатывает уже выполненный штатный Archive.

Jira, CI, Zephyr, Confluence и другие внешние системы остаются adapters команды и не
становятся источником требований. Если политика проекта требует публикацию архивной
копии, она должна быть идемпотентной и ссылаться на архивную Git revision Store. Сбой
внешней публикации не изменяет OpenSpec artifacts.

## Исключения

Для каждого исключения ОБЯЗАТЕЛЬНЫ причина, владелец решения, область, срок действия и
компенсирующая проверка. Неизвестный владелец или бессрочное исключение блокирует
соответствующий Gate.
