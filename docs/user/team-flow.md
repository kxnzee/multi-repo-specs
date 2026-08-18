# Командный процесс OpenSpec

Этот документ описывает целевой процесс команды поверх штатного OpenSpec. Он не
добавляет команды Orchestrator Core и не изменяет встроенные `opsx-*` workflows.

## Поток одного Change

1. **Jira Story** — источник запроса, ожидаемого результата и владельца.
2. **Planning** — Analyst создаёт Proposal, Delta Specs, Design и Tasks.
3. **Gate 1** — Analyst, Developer и QA подтверждают план; Lead подключается по
   риск-триггерам.
4. **Development** — Code Repositories реализуют принятый Change.
5. **PR Review** — проверяются код, тесты и соответствие принятой OpenSpec revision.
6. **Gate 2** — фиксируется кандидат на проверку: точные commits, сборка и Snapshot.
7. **IFT** — проверка кандидата согласно принятой проектом IFT policy.
8. **QA Verification** — проверка OpenSpec Scenarios и связанных Zephyr cases.
9. **Gate 3** — подтверждение готовности проверенного Snapshot к релизу.
10. **Release** — продвигается тот же проверенный artifact.
11. **Archive** — штатный OpenSpec Archive и обязательная производная копия в
    Confluence.

Разработчик открывает персональный OpenSpec Workset, в котором его Code Repository
является первым member, а центральный Store — вторым, и запускает штатный
`/opsx:apply <change-id>`. Project skill `openspec-base-apply-context` подтверждает
текущий Cycle и выполняет только sections Tasks этого repository-id. Общая секция
выполняется указанным owner либо primary solution owner из Design. Изменение
Proposal, Specs, Design или текста Tasks во время активного Cycle возвращает Change
в Planning; обычное переключение checkbox является состоянием выполнения. Apply
переключает checkbox только после task-level evidence: требуемый artifact существует,
а предусмотренная задачей проверка фактически выполнена. Для test-задачи отсутствие
test-файла или успешного запуска оставляет `[ ]` и блокирует completed Result Receipt.

## Артефакты Planning

Полный Change включает:

- `proposal.md` — зачем и что меняется;
- `specs/<capability>/spec.md` — наблюдаемое поведение и Scenarios;
- `design.md` — технические решения, риски, миграция и rollback;
- `tasks.md` — проверяемый план реализации.

Proposal содержит Repository impact с точными `repository-id` из
`openspec-orch.yaml`. Design разделяет часть решения, контракты и зависимости каждого
затронутого репозитория; Tasks группируются по тем же id. Для релевантного, но
незатронутого репозитория фиксируется `no-change`, чтобы отсутствие работы было
решением, а не пропуском анализа.

Specs при этом не дробятся по репозиториям: Requirement и Scenario описывают
наблюдаемое поведение capability, а Repository impact показывает, где это поведение
реализуется и проверяется.

Если поведение меняется, Proposal перечисляет каждую новую или изменяемую capability,
а Change содержит один Delta Spec на её существующем пути. `skip_specs` допустим
только когда наблюдаемое поведение действительно не меняется.

Новый Scenario получает стабильный ID в заголовке:

```markdown
#### Scenario: [SC-PAYMENT-RETRY-001] Временная ошибка устранена
```

Формат — `SC-<CAPABILITY>-NNN`. Существующий ID не переименовывается и не
переиспользуется для другого поведения. Retained Scenarios в `MODIFIED` сохраняют
свои ID; массовое присвоение ID старым Master Specs выполняется отдельным Change.

## Gate 1 — Planning accepted

Обязательный вход:

- Jira Story связана с `change-id`;
- OpenSpec Change проходит строгую валидацию;
- Proposal, Delta Specs, Design и Tasks согласованы между собой;
- определены затронутые capability, системы и Code Repositories;
- Repository impact, Design и Tasks используют одинаковый набор зарегистрированных
  `repository-id`, либо различие явно обосновано;
- тест-кейсы покрывают каждый новый или изменённый Scenario;
- решения, влияющие на scope, Specs, Design или Tasks, закрыты.

Результат — явное решение участников и точная принятая planning revision. Lead
обязателен для breaking contract, security/compliance, миграции данных, нескольких
доменов, изменения SLO или необратимого rollout.

## Gate 2 — Implementation candidate

Обязательный вход:

- завершены требуемые implementation PR;
- PR Review подтвердил OpenSpec alignment или зарегистрировал отклонения;
- CI и обязательные component/contract проверки успешны;
- определены точные commit SHA всех Code Repositories;
- определён build, image или иной поставляемый artifact;
- вычислен один Snapshot для передачи в IFT и QA.

Gate 2 не утверждает качество продукта: он фиксирует однозначного кандидата на
проверку.

## Gate 3 — Release ready

Обязательный вход:

- IFT выполнен на Snapshot Gate 2;
- QA проверила относящиеся к Change OpenSpec Scenarios;
- Zephyr executions связаны со Scenario IDs и Snapshot;
- нет блокирующих дефектов;
- подтверждены rollout, наблюдение и rollback;
- release artifact соответствует проверенному Snapshot.

## Инвалидация

- Новая planning revision требует повторного Gate 1 и нового Cycle.
- Изменение состава репозиториев требует повторного Gate 1.
- Новый implementation commit или build создаёт нового кандидата и инвалидирует
  Gate 2, IFT, QA и Gate 3 старого Snapshot.
- Изменение только внешней ссылки без изменения её результата не должно менять
  Snapshot, но сохраняется в audit trail.
- Изменение наблюдаемого поведения во время Development возвращается в Planning, а не
  маскируется правкой кода или Tasks.

## Archive и Confluence

Archive разрешён только после завершения реализаций, ручной проверки и релиза в
соответствии с политикой проекта. Штатный `/opsx-archive` остаётся владельцем
синхронизации Delta Specs и перемещения Change.

Для Confluence требуется идемпотентная публикация архивной копии, ключ которой
включает Store, `change-id` и archive revision. Страница содержит Jira, архивную Git
revision, итоговые Specs и Design, Snapshot, release artifact, PR, Zephyr и решения
Gate. Сбой публикации не меняет OpenSpec-файлы, но Archive handoff считается
незавершённым до успешного повтора.

Confluence не становится источником требований: при расхождении приоритет имеет
архивная Git revision центрального Store.

## Исключения

Для каждого исключения фиксируются причина, владелец решения, область, срок действия
и компенсирующая проверка. Неизвестный владелец или бессрочное исключение блокирует
соответствующий Gate.
