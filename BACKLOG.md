# Backlog OpenSpec Orchestrator после Alpha-пилота

Статус: **кандидаты на развитие после ревизии пилота**.

Текущий контракт Alpha зафиксирован в
[`docs/technical/alpha-concept.md`](docs/technical/alpha-concept.md)
и до пилота не расширяется. Задачи ниже не являются планом текущей разработки.

## Правило заморозки Core

До завершения пилота production-код `src/` изменяется только когда одновременно
выполнены условия:

1. наблюдение записано в `docs/user/pilot-feedback.md` на реальном Change либо
   воспроизводимом smoke-test обязательного пути пилота;
2. подтверждён дефект относительно Alpha-контракта или блокирующий прохождение пилота
   кейс;
3. выбрано минимальное исправление без добавления новой продуктовой возможности;
4. исправление покрыто тестом и не расширяет восемь операций Alpha.

Новая идея, удобство или интеграция сами по себе не являются основанием снимать
заморозку. После пилота каждая задача ниже проходит отдельное решение: удалить,
уточнить, оставить в backlog или перенести в Beta Plan.

## Кандидаты P0

### ORCH-B01 — разделяемое командное состояние

Перенести Receipts, Snapshots и Gate evidence из состояния одной машины в
версионированное разделяемое хранилище. Обеспечить конкурентный доступ, историю,
атомарную запись, восстановление и работу нескольких участников.

**Триггер:** пилот подтверждает, что локальное состояние мешает передаче работы или
совместной проверке.

### ORCH-B02 — универсальный Gate Receipt

Добавить типизированную запись решения Gate с `change_id`, типом Gate, решением,
ролью и identity участника, planning revision или Snapshot, evidence, исключениями,
временем и связью с заменённым решением.

Предполагаемая поверхность после отдельного проектирования:

```text
openspec-orch gate status <change-id>
openspec-orch gate record <change-id> --gate <planning|implementation|release>
openspec-orch gate history <change-id>
```

**Триггер:** на пилоте требуется разделяемое доказательство хотя бы одного Gate.

### ORCH-B03 — инвалидация downstream evidence

Вычислять актуальность решений: новая planning revision создаёт новый Cycle и
инвалидирует последующие Gate; новый набор implementation revisions создаёт новый
Snapshot и инвалидирует IFT, QA и release approval.

**Триггер:** зафиксирован случай перепланирования или изменения реализации после
проверки.

### ORCH-B04 — идентичность сборки и развёртывания

Расширить проверяемую проекцию ссылками на build, container digest, pipeline run,
environment/deployment и migration version. Не менять алгоритм Alpha Snapshot без
новой версии контракта.

**Триггер:** commit SHA недостаточно, чтобы однозначно определить проверенный релизный
артефакт.

### ORCH-B05 — реестр внешнего evidence

Определить provider-neutral ссылки на Jira, PR, CI, IFT, Zephyr, security scan,
release и Confluence. Core хранит тип, identity и статус evidence, но не знает API
конкретного продукта.

**Триггер:** пилот показывает ручную потерю или неоднозначность ссылок между этапами.

### ORCH-B06 — машиночитаемый и неинтерактивный контракт

Добавить стабильный JSON-вывод, разделение stdout/stderr, документированные exit
codes и безопасное подтверждение для CI и Plugins ко всем требуемым операциям.

**Триггер:** появляется первый машинный потребитель Alpha CLI.

### ORCH-B07 — полное вычисляемое состояние Change

Расширить `status` вычисляемыми этапами и причинами блокировки: planning, Gate 1,
implementation results, Snapshot, Gate 2, IFT, QA, Gate 3, release, Archive и
Confluence publication. Не хранить дублирующий mutable `phase`.

**Триггер:** участники пилота регулярно ошибаются в следующем действии.

### ORCH-B08 — детерминированное перепланирование и rebinding

Определить correction flow после принятого Planning: новый Cycle, новый состав
репозиториев, сохранение истории, явная связь с заменённым Cycle и безопасное
переназначение результатов.

**Триггер:** реальный Change меняет план или состав репозиториев после Gate 1.

## Кандидаты P1

### ORCH-B09 — Plugin API и transactional outbox

Определить out-of-process Plugin API, версионированные события, idempotency key,
повторные попытки, dead-letter состояние, contract test kit и явные разрешения на
чтение/запись. Plugin failure не должен повреждать OpenSpec или Core state.

### ORCH-B10 — Jira, Zephyr и Confluence Plugins

После ORCH-B09 реализовать раздельные Plugins:

- Jira: связь Story, Change, Gate и release;
- Zephyr: публикация тест-кейсов и результатов для конкретного Snapshot;
- Confluence: обязательная идемпотентная публикация архивной копии с Git provenance.

Интеграции не встраиваются напрямую в Core.

### ORCH-B11 — сквозная трассировка

Добавить read-only представление `Jira → Change → Requirement/Scenario → Task →
PR/commit → Snapshot → Verification → Release → Archive/Confluence` и пригодный для
автоматизации JSON-контракт.

### ORCH-B12 — identity, роли и полномочия

Определить подтверждаемую identity, допустимые роли для Gate, разделение обязанностей,
делегирование, исключения и audit trail. Не кодировать фиксированные должности в
ядре; использовать project policy.

### ORCH-B13 — хранение истории и аудит

Добавить retention, экспорт, проверку целостности и восстановление истории Cycle,
Receipts, Gate и внешних evidence.

### ORCH-B14 — зависимости Changes и Release Train

Поддержать dependency graph активных Changes, порядок Gate/Archive зависимых Changes,
группировку нескольких Snapshots в релиз и обнаружение конфликтов.

### ORCH-B15 — Archive readiness и publication status

Вычислять готовность к штатному OpenSpec Archive без его подмены. После Archive
отслеживать обязательную публикацию Confluence и явно показывать неполный внешний
handoff.

### ORCH-B16 — операционная поддержка CodeGraph

Опционально обнаруживать `.codegraph/` в Code Repositories, показывать здоровье и
устаревание индекса, а также адресно запускать `init`/`sync` через Plugin или явную
операцию. Сам индекс и MCP остаются ответственностью CodeGraph и Code Repository.

### ORCH-B17 — read-only API и dashboard

Предоставить стабильный API для представления состояния нескольких Changes без
дублирования источников истины и без возможности обходить проверки CLI.

## Не добавлять в Core

- проектные опросники и правила Proposal;
- анализ влияния и семантическое review Change;
- генерацию тест-кейсов;
- запуск LLM и выбор subagents;
- непосредственную реализацию Jira, Zephyr, Confluence или CodeGraph;
- типы репозиториев `backend`, `frontend`, `mobile`;
- отдельный implementation workflow поверх штатного OpenSpec Apply;
- автоматические commit, push, merge, release или Archive без отдельного решения
  после пилота.

## Ревизия после пилота

Для каждого кандидата собрать ссылки на записи `docs/user/pilot-feedback.md`, частоту,
стоимость ручного обхода и риск ошибки. Порядок Beta определяется только этими
наблюдениями; текущие номера не задают очередь реализации.
