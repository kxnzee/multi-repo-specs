# Работа с Changes

Выберите свой случай:

- фича уже есть в Master Specs, а поведение нужно изменить —
  [изменение существующей Master Spec](#изменение-существующей-master-spec);
- одна задача затрагивает несколько Specs —
  [один Change с несколькими Delta Specs](#один-change-с-несколькими-delta-specs);
- один Change нужен для планирования другого —
  [зависимые Changes одного релиза](#зависимые-changes-одного-релиза);
- уже созданный Change нужно поправить —
  [изменение активного Change](#изменение-уже-созданного-change).

## Изменение существующей Master Spec

Если фича уже описана в Master Specs, всё равно создаётся новый Change. Но его Delta
Spec указывает на существующую capability и после Archive обновляет её исходный файл.

Порядок работы:

1. Change Owner описывает, какое поведение нужно изменить.
2. Агент находит соответствующие capability и Requirement в Master Specs.
3. Агент выбирает Delta operation и создаёт Delta Spec по тому же capability path.
4. Spec Owner проверяет этот выбор в Planning PR.
5. Archive применяет дельту к исходной Master Spec.

```text
Master Spec: openspec/specs/<capability>/spec.md
Delta Spec:  openspec/changes/<change-id>/specs/<capability>/spec.md
```

Новая capability `<capability>-v2` не создаётся. Delta Spec и архивная копия Change —
это история изменения, а не вторая Master Spec.

### Кто выбирает Delta operation

Операцию предлагает агент, сравнивая намерение Change Owner с текущей Master Spec.
Change Owner не обязан выбирать синтаксис вручную. Если результат неоднозначен, агент
показывает варианты и задаёт вопрос. Окончательный выбор проверяет Spec Owner в
Planning PR.

| Состояние Master Spec и намерение | Delta operation |
|---|---|
| В существующей capability появляется отдельное новое правило | `ADDED` |
| Меняется существующее Requirement или его Scenarios | `MODIFIED` |
| Существующее Requirement больше не должно действовать | `REMOVED` |
| Меняется только имя Requirement | `RENAMED` |
| Наблюдаемое поведение не меняется | Delta Spec не нужен |

### Правила операций

- `ADDED` добавляет отдельное новое Requirement в ту же capability.
- `MODIFIED` содержит полную новую версию Requirement, включая все Scenarios, которые
  должны сохраниться.
- `REMOVED` указывает удаляемое Requirement, причину и миграцию.
- `RENAMED` меняет только имя через штатные `FROM` и `TO`. Если вместе с именем
  меняется поведение, агент использует `RENAMED` и полный `MODIFIED` под новым именем.

Proposal относит существующую capability к `Modified Capabilities`, а новую — к
`New Capabilities`. Для рефакторинга, tooling или документации без изменения
наблюдаемого поведения capability не добавляется; используется штатный
`skip_specs: true`, когда его требует OpenSpec workflow.

### Пример

В Master Specs уже есть capability `payment-status`:

```text
openspec/specs/payment-status/spec.md
└── Requirement: Отображение статуса платежа
    ├── Scenario: Платёж обрабатывается
    └── Scenario: Платёж завершён
```

Новая задача требует показывать ещё и неуспешный платёж.

Агент определяет:

```text
capability: payment-status
requirement: Отображение статуса платежа
operation: MODIFIED
```

И создаёт Delta Spec по тому же пути внутри Change:

```text
openspec/changes/pay-412-payment-failed/
└── specs/payment-status/spec.md
```

В `MODIFIED` агент записывает полную новую версию Requirement: два прежних Scenario и
новый Scenario «Платёж завершён с ошибкой». После Archive обновится
`openspec/specs/payment-status/spec.md`; второй `payment-status-v2` не появится.

## Проверка в Planning PR

Для такого Change добавьте в описание Planning PR:

- пути затронутых Master Specs;
- имена Requirements и выбранные Delta operations;
- ожидаемый результат Archive для каждого пути: что будет добавлено, заменено,
  удалено, переименовано или создано.

Spec Owner проверяет соответствие каждого Delta path целевой capability, правильные
операции и отсутствие параллельных Specs. Для `MODIFIED` он дополнительно проверяет
полную версию Requirement и сохранение прежних актуальных Scenarios.

После rebase повторите `openspec validate --strict` и содержательную проверку
относительно актуальной Master Spec. Штатная валидация проверяет структуру дельты, но
выбор целевого поведения и отсутствие смыслового дублирования подтверждаются Change
Owner и Spec Owner.

## Один Change с несколькими Delta Specs

Один Change может изменять или создавать несколько capabilities, если все они нужны
для одной бизнес-цели. Для каждой capability агент создаёт отдельную Delta Spec и
сохраняет её относительный путь из Master Specs.

Дополнительная команда SDD для этого не нужна. Используется обычный маршрут:

| Этап | Что вызвать | Результат |
|---|---|---|
| Explore | `sdd explore --ticket PAY-500` | Подтверждена одна бизнес-цель и найдены затронутые системы |
| Change и Proposal | `/sdd-change PAY-500 payment-recovery` | Создан один Change и одна planning-ветка |
| Specs | первый `/opsx-continue pay-500-payment-recovery` | Созданы все Delta Specs этого Change |
| Design | второй `/opsx-continue pay-500-payment-recovery` | Описаны связи между capabilities и репозиториями |
| Tasks | третий `/opsx-continue pay-500-payment-recovery` | Созданы Work Packages для общей реализации |
| Planning PR | обычные команды шага 04 | Принят один `spec_baseline` для всего Change |
| Реализация | `sdd load` отдельно в каждом Code Repository | Загружены назначенные Work Packages общего Change |
| Finalization | `/opsx-archive pay-500-payment-recovery` | Все Delta Specs применены к соответствующим Master Specs |

Кастомный SDD отвечает за подготовку контекста, создание каркаса Change, фиксацию
Baseline и передачу Work Packages в Code Repositories. Стандартный OpenSpec создаёт
Specs, Design и Tasks через `/opsx-continue`, проверяет Change и применяет Delta Specs
через `/opsx-archive`.

### Исходная задача

Ticket `PAY-500` требует единый сценарий восстановления после ошибки платежа:

- показать пользователю неуспешный статус;
- разрешить повтор платежа;
- отправить уведомление об ошибке.

Это одна бизнес-цель, поэтому создаётся один Change
`pay-500-payment-recovery`. Если эти возможности можно согласовать, реализовать и
поставить независимо, их следует разделить на разные Changes.

До начала работы в Store уже существуют:

```text
openspec/specs/
└── payments/
    ├── status/spec.md
    └── retry/spec.md
```

Capability `notifications/payment-failure` пока отсутствует.

### Шаг 01. Выполнить Explore

Из корня Store выполните:

```bash
sdd explore --ticket PAY-500
```

Выберите затронутые Code Repositories и передайте намерение:

```text
Определить единый пользовательский сценарий восстановления после неуспешного платежа:
показать ошибку, разрешить повтор и отправить уведомление.
```

`sdd explore` вернёт готовое сообщение для `/opsx-explore`. Передайте его агенту без
изменений и завершите обычный [шаг 01](../steps/01.md). Explore должен подтвердить,
что все три изменения относятся к одной задаче.

### Шаг 02. Создать один Change и Proposal

В той же агентской сессии выполните:

```text
/sdd-change PAY-500 payment-recovery
```

Кастомная команда SDD создаст:

```text
branch: feature/pay-500-payment-recovery
change: openspec/changes/pay-500-payment-recovery/
artifact: proposal.md
```

В Proposal должны быть перечислены все capabilities:

```markdown
## Modified Capabilities

- payments/status
- payments/retry

## New Capabilities

- notifications/payment-failure
```

`payments/status` и `payments/retry` уже существуют, поэтому сохраняются их текущие
пути. `notifications/payment-failure` объявляется новой capability. После проверки
подтвердите Proposal как обычно на [шаге 02](../steps/02.md).

Не вызывайте `/sdd-change` отдельно для каждой capability: это создаст три независимых
Changes вместо одного согласованного изменения.

### Шаг 03. Создать все Delta Specs

Проверьте состояние:

```bash
openspec status \
  --change pay-500-payment-recovery \
  --store payments-specs
```

Затем один раз вызовите:

```text
/opsx-continue pay-500-payment-recovery
```

Один вызов создаёт артефакт Specs целиком, то есть все три файла, а не одну выбранную
Delta Spec:

```text
openspec/changes/pay-500-payment-recovery/
└── specs/
    ├── payments/
    │   ├── status/spec.md
    │   └── retry/spec.md
    └── notifications/
        └── payment-failure/spec.md
```

Первая Delta Spec изменяет существующее Requirement и поэтому содержит его полную
новую версию со всеми сохраняемыми Scenarios:

```markdown
## MODIFIED Requirements

### Requirement: Отображение статуса платежа
Система SHALL показывать пользователю актуальный результат обработки платежа.

#### Scenario: Платёж обрабатывается
- **WHEN** платёж ещё выполняется
- **THEN** система показывает статус «Обрабатывается»

#### Scenario: Платёж завершён
- **WHEN** платёж успешно выполнен
- **THEN** система показывает статус «Оплачен»

#### Scenario: Платёж завершён с ошибкой
- **WHEN** платёж отклонён
- **THEN** система показывает статус «Не выполнен» и понятную причину
```

В существующую capability повторов добавляется самостоятельное Requirement:

```markdown
## ADDED Requirements

### Requirement: Повтор неуспешного платежа
Система SHALL разрешать повтор только для платежа, завершённого с ошибкой.

#### Scenario: Повтор доступен
- **WHEN** пользователь открывает платёж со статусом «Не выполнен»
- **THEN** система предлагает повторить платёж
```

Для новой capability Delta Spec содержит `Purpose` и `ADDED Requirements`:

```markdown
## Purpose

Определяет уведомление пользователя о неуспешном платеже и доступном следующем действии.

## ADDED Requirements

### Requirement: Уведомление об ошибке платежа
Система SHALL отправлять уведомление после окончательного отказа в обработке платежа.

#### Scenario: Уведомление отправлено
- **WHEN** платёж получает окончательный статус «Не выполнен»
- **THEN** пользователь получает уведомление с причиной и возможностью повтора
```

После проверки Specs ещё дважды вызовите ту же команду:

```text
/opsx-continue pay-500-payment-recovery
/opsx-continue pay-500-payment-recovery
```

Второй вызов создаст единый Design, который объясняет связь трёх capabilities,
затронутые `repository-id`, совместимость и порядок поставки. Третий создаст общие
Tasks и Work Packages. Отдельные Design и Tasks для каждого файла не создаются.

### Шаг 04. Принять единый Baseline

Выполните обычные проверки всего Change:

```bash
openspec show pay-500-payment-recovery \
  --type change \
  --no-interactive \
  --store payments-specs

openspec validate pay-500-payment-recovery \
  --type change \
  --strict \
  --no-interactive \
  --store payments-specs
```

В одном Planning PR проверьте соответствие путей:

```text
payments/status             → существующая Master Spec, MODIFIED
payments/retry              → существующая Master Spec, ADDED Requirement
notifications/payment-failure → новая Master Spec, Purpose + ADDED Requirement
```

После merge SHA основной ветки Store становится одним `spec_baseline` для всех Delta
Specs, Work Packages и Code Repositories этого Change.

Получите Work Package ID:

```bash
openspec instructions apply \
  --change pay-500-payment-recovery \
  --store payments-specs \
  --json
```

Implementation subtasks создаются по Code Repositories, а не по Delta Specs. Например:

```text
pay-500-payment-recovery payments-api Реализация
pay-500-payment-recovery payments-ui Реализация
pay-500-payment-recovery notifications-service Реализация
```

Одна subtask может получить Work Packages, относящиеся сразу к нескольким
capabilities, если их реализует один репозиторий.

### Шаги 05–06. Реализовать Work Packages

Разработчик каждого репозитория запускает обычный `sdd load`. Например, для API:

```bash
sdd load \
  --store payments-specs \
  --repo payments-api \
  --change pay-500-payment-recovery \
  --baseline <accepted-40-character-revision> \
  --work-package 1 \
  --work-package 2
```

`sdd load` не принимает capability path и не загружает одну Delta Spec отдельно. Он
фиксирует весь Change на принятом Baseline, а область конкретной реализации задаётся
выбранными Work Package ID. Дальше каждый репозиторий проходит обычные шаги
[05](../steps/05.md) и [06](../steps/06.md).

### Archive. Применить Delta Specs к Master Specs

Первый пилот заканчивается до Archive. После реализации всех репозиториев, Composite
Verification, rollout и manual verification на разрешённом этапе Finalization
выполните стандартную команду:

```text
/opsx-archive pay-500-payment-recovery
```

OpenSpec обрабатывает все Delta Specs этого Change и сохраняет относительные пути:

```text
Delta Spec                                           Результат в Master Specs
payments/status/spec.md                             обновить payments/status/spec.md
payments/retry/spec.md                              обновить payments/retry/spec.md
notifications/payment-failure/spec.md               создать notifications/payment-failure/spec.md
```

Новый файл создаётся не из-за упоминания в Design. Для него должны одновременно
существовать запись в `New Capabilities` и Delta Spec с `Purpose` и
`ADDED Requirements`.

Для самого множественного изменения `/opsx-sync` не нужен. Он вызывается только если
поведение этого активного Change требуется другому Change до Archive — по сценарию
[зависимых Changes](#зависимые-changes-одного-релиза).

## Зависимые Changes одного релиза

Этот сценарий используется, когда поведение активного Change A необходимо как основа
для отдельного Change B до завершения релиза и Archive A.

Обычный Change проходит шаги 01–06 без раннего Sync. Для зависимых Changes применяется
маршрут:

```text
Planning PR A → Sync PR A → Explore и Planning B → реализация A и B
```

### Что означает ранний Sync

Стандартный `/opsx-sync <change-a>` переносит принятую Delta Specs A в Master Specs,
чтобы агент мог планировать B относительно актуальной нормативной базы.

После Sync Change A остаётся активным. Sync не подтверждает реализацию или rollout A,
не заменяет Archive и не отменяет действующие проверки релиза.

### Подготовка Change A

Сначала завершите обычное планирование A:

1. подготовьте Proposal, Specs, Design и Tasks;
2. проверьте и слейте Planning PR A;
3. сохраните принятую `spec_baseline A`.

До merge Planning PR A ранний Sync не выполняется.

### Создание Sync PR

Из актуальной основной ветки центрального Store создайте отдельную ветку:

```bash
git switch <default-branch>
git pull --ff-only origin <default-branch>
git switch -c sync/<change-a>
```

Запустите новую агентскую сессию из корня Store и выполните:

```text
/opsx-sync <change-a>
```

Просмотрите изменение Master Specs:

```bash
git status --short
git diff -- openspec/specs
git add -- openspec/specs
git diff --cached --check
git diff --cached --name-only
```

Создайте commit и опубликуйте ветку:

```bash
git commit -m "<change-a> Синхронизированы Master Specs для зависимого Change"
git push -u origin sync/<change-a>
```

Откройте отдельный Sync PR в основную ветку Store. Укажите в описании:

- Change A и его Planning PR;
- зависимый Change B или его ticket;
- что Change A после Sync остаётся активным.

Change B можно начинать только после merge Sync PR A.

### Подготовка Change B

Перед Explore B обновите основную ветку Store, чтобы она содержала слитый Sync PR A.
Затем выполните обычные шаги 01–04 для B со следующими дополнениями:

- Proposal B содержит ссылки на Change A и Sync PR A;
- Specs B описывают только дельту B относительно обновлённых Master Specs и не
  копируют Delta Specs A;
- Design B фиксирует зависимость от A, интеграционный контракт, совместимость и
  порядок поставки;
- Tasks B включают проверку зависимости и совместную Composite Verification A и B;
- Planning PR B содержит ссылки на Change A и Sync PR A.

Если Sync PR A ещё не слит, не начинайте Explore и планирование B.

### Пример синхронизации

Есть две задачи одного релиза:

- `PAY-412` добавляет статус неуспешного платежа — Change
  `pay-412-payment-failed`;
- `PAY-427` добавляет повтор платежа после ошибки — Change
  `pay-427-retry-failed-payment`.

Change B зависит от поведения Change A: повтор платежа нельзя описать, пока в Master
Specs нет состояния «платёж завершён с ошибкой».

Сначала команда завершает Planning PR Change A. Затем из актуальной основной ветки
Store выполняет:

```bash
git switch main
git pull --ff-only origin main
git switch -c sync/pay-412-payment-failed
```

В новой агентской сессии запускается:

```text
/opsx-sync pay-412-payment-failed
```

После проверки diff открывается отдельный Sync PR. Например, его описание содержит:

```markdown
Source Change: [pay-412-payment-failed](<change-a-url>)
Planning PR: [PR #120](<planning-pr-a-url>)
Dependent ticket: [PAY-427](<ticket-b-url>)

Change pay-412-payment-failed остаётся активным до завершения релиза и Archive.
```

После merge Sync PR основная ветка Store уже содержит статус ошибки в Master Specs.
Только теперь команда запускает Explore и создаёт Change B.

В Proposal B добавляются человекочитаемые ссылки:

```markdown
## Dependencies

- Source Change: [pay-412-payment-failed](<change-a-url>)
- Sync PR: [PR #128](<sync-pr-a-url>)
```

В Design B фиксируется смысл зависимости:

```markdown
Повтор платежа доступен только для состояния «платёж завершён с ошибкой»,
принятого в [pay-412-payment-failed](<change-a-url>) и перенесённого в Master Specs
через [Sync PR #128](<sync-pr-a-url>).
```

Delta Specs B описывают только повтор платежа. Статус ошибки из A в них не копируется.
После общей реализации и проверки релиза Changes архивируются по порядку:

```text
/opsx-archive pay-412-payment-failed
/opsx-archive pay-427-retry-failed-payment
```

### Если Change A изменился после Sync

#### Planning B ещё не начат

1. проведите [коррекцию Change A](#коррекция-после-merge-planning-pr);
2. повторите `/opsx-sync <change-a>` через новый Sync PR;
3. начинайте B только после merge нового Sync PR.

#### Planning PR B открыт

1. остановите merge Planning PR B;
2. проведите коррекцию Change A и слейте новый Sync PR A;
3. обновите ветку B относительно основной ветки Store;
4. выполните `/opsx-update <change-b>`;
5. проверьте Specs, Design и Tasks B и обновите ссылку на Sync PR A;
6. продолжите review Planning PR B.

#### Реализация B уже началась

1. остановите затронутые Work Packages и implementation PR B;
2. проведите коррекцию Change A и слейте новый Sync PR A;
3. определите влияние изменения A на planning-артефакты и код B;
4. выполните для B сценарий [коррекции после merge Planning PR](#коррекция-после-merge-planning-pr);
5. продолжите реализацию B по разделу [«Реализация уже началась»](#реализация-уже-началась).

### Если Change A отменён после Sync

1. остановите известные зависимые Changes;
2. не удаляйте Change A и не редактируйте Master Specs напрямую;
3. откройте отдельный revert/correction PR, возвращающий Master Specs в согласованное
   состояние;
4. укажите в PR Change A, его Sync PR и причину отмены;
5. для каждого зависимого Change примите решение: отменить, перепланировать или
   перевести на другую зависимость;
6. не используйте Archive как замену откату.

### Если зависимостей несколько

До начала планирования зависимого Change дождитесь Sync PR всех исходных Changes.
Перечислите каждую зависимость и её Sync PR в Proposal и Design, а в Tasks добавьте
совместную Composite Verification. Агент учитывает эти связи при планировании, а
участники подтверждают порядок поставки и Archive в Planning PR.

### Завершение релиза

Ранний Sync не меняет действующие условия финализации. После завершения реализации,
общей проверки системы, rollout и manual verification зависимые Changes архивируются
в порядке зависимости:

```text
/opsx-archive <change-a>
/opsx-archive <change-b>
```

Этот порядок применяется только на разрешённом проектом этапе Finalization и не
расширяет границы шагов первого пилота.

## Изменение уже созданного Change

Если Proposal, Specs, Design или Tasks активного Change нужно поправить, новый Change
не создаётся. Обновляется тот же `<change-id>` через:

```text
/opsx-update <change-id>
```

Дальнейшие действия зависят от того, слит ли Planning PR.

### Planning PR ещё не слит

Исправьте тот же Change, добавьте commit в ту же planning-ветку и продолжите review
того же Planning PR. Если замечание не меняет согласованный scope, новый Explore не
нужен.

### Изменение scope до merge Planning PR

Если замечание к открытому Planning PR меняет согласованное поведение, границы Change
или добавляет внешнюю систему:

1. остановите merge Planning PR;
2. проведите Explore для нового или изменённого scope;
3. после подтверждения Change Owner обновите тот же Change через
   `/opsx-update <change-id>`;
4. повторите проверки Planning PR и продолжите review того же Change.

### Коррекция после merge Planning PR

После merge старая SHA уже используется как `spec_baseline`. Поэтому correction
проходит через отдельный Planning PR и создаёт новый Baseline для того же Change.

Порядок работы:

1. остановите передачу новых Work Packages и затронутую реализацию;
2. создайте correction-ветку от актуальной основной ветки Store;
3. выполните `/opsx-update <change-id>` для существующего Change;
4. повторите `openspec status`, `openspec show` и `openspec validate --strict`;
5. откройте и слейте correction Planning PR;
6. примите полную SHA результата merge как новый
   `spec_baseline` Change;
7. снова получите Work Package ID через `openspec instructions apply` и обновите
   implementation subtasks.

Если Change ранее синхронизировали с Master Specs для зависимой работы, дополнительно
используйте сценарий [«Change A изменился после Sync»](#если-change-a-изменился-после-sync).

### Пример изменения активного Change

Существует Change `pay-412-payment-failed`. В его Specs уже добавлен статус ошибки,
но выяснилось, что пользователь также должен видеть понятную причину отказа.

Если Planning PR ещё открыт:

```text
/opsx-update pay-412-payment-failed
```

Агент исправляет Specs, Design и Tasks в этом же Change. Изменения отправляются в ту
же ветку и тот же Planning PR.

Если Planning PR уже слит и реализация началась, Change также остаётся прежним. Change
Owner открывает correction Planning PR, обновляет `pay-412-payment-failed`, получает
новый `spec_baseline` и передаёт его разработчикам. Создавать
`pay-413-payment-failed-v2` не нужно.

### Реализация уже началась

Разработчик не переключает Baseline работающей Apply-сессии вручную. После сообщения о
принятой correction:

1. остановите работу по затронутым Work Packages;
2. дождитесь обновления `spec_baseline` и Work Package ID в implementation subtask;
3. повторите [шаг 05](../steps/05.md) с обновлёнными параметрами;
4. передайте новый `next_action` в новую Apply-сессию;
5. проверьте текущий diff относительно нового Baseline и продолжите только актуальную
   работу в той же implementation-ветке и PR.
