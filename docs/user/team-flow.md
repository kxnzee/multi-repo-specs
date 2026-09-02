# Командный поток и роли

Роли обозначают ответственность в процессе, а не учётные записи или ACL
Orchestrator. Один человек может совмещать несколько ролей, но решения, evidence и
передача ответственности должны оставаться явными.

## Ответственность

| Роль | Отвечает за |
|---|---|
| Владелец Change | Intent или одобрение Brainstorm, продуктовый scope, критерии успеха, gates и Release-решение |
| Аналитик | Intake, Proposal, Delta Specs, Repository Impact и сквозную трассировку |
| Разработчик | Design, Tasks, Plan, implementation, review и repository checks |
| Тестировщик | Проверяемость Scenarios и evidence точного candidate |
| Лид | Breaking contracts, security/compliance, data migration, SLO и rollout risk |

Лид подключается по риску или политике проекта. Неизвестный владелец решения,
бессрочное исключение или gate, принятый только Agent, считаются blocker.

## Поток

Один Store может одновременно содержать Changes с разными schemas. Команда следует
актуальным OpenSpec `status` и `instructions` конкретного Change:

| Schema | Planning и выполнение |
|---|---|
| `spec-driven-extended` | Intent → Intake → Proposal → Specs + опциональный Design → Tasks → Gate 1 → Apply → Verify |
| `superspec-multirepo` | Brainstorm → Proposal → Specs + опциональный Design → Tasks → Plan → Gate 1 → Apply → Verify |

Для Superspec обязательны одобренный Brainstorm, подробный Plan, TDD/review
discipline и отдельная Process Compliance. Intake относится только к
`spec-driven-extended`. Apply является штатным действием OpenSpec, а не отдельным
artifact. Planning и Verify принадлежат Store; реализация и repository checks —
Code Repositories.

После Verify процесс продолжается одинаково:

```text
точный implementation candidate
→ Gate 2: candidate принят
→ Gate 3: release ready
→ фактический Release
→ Archive
```

## Gate 1: Planning принят

До реализации команда подтверждает:

- согласованный Intent и завершённый Intake для `spec-driven-extended` либо явно
  одобренный Brainstorm для `superspec-multirepo`;
- валидные применимые Planning artifacts и отсутствие blocker;
- Delta Specs для каждого изменения поведения либо корректный `skip_specs: true`,
  когда поведение не меняется;
- точные зарегистрированные Code Repository IDs в Repository Impact и одинаковый
  scope в Proposal, Design, Tasks и Plan;
- разрешённые вопросы, которые могут изменить Specs, подход или Tasks;
- способ проверки каждого нового или изменённого Scenario;
- межрепозиторные зависимости, порядок выполнения, rollout/rollback и risk triggers.

Если подключён OpenSpec Graph, `openspec-orch plugin exec openspec-graph inspect --json` из Store должен
завершаться без errors. Graph подтверждает структуру Store, но не доказывает
repository ownership, реализацию, runtime dependency или deployment.

Gate 1 относится к точной Planning revision. Изменение поведения, scope, Design,
состава repositories, Tasks или Plan возвращает Change в Planning и требует нового
принятия Gate 1.

## Реализация в нескольких repositories

Каждый разработчик запускает штатный OpenSpec Apply из назначенного Code Repository
и работает только со своей repository section. Assignment, Repository Impact и
Tasks либо Plan должны совпадать. Если во время Apply обнаружен новый Repository,
capability или изменение принятого scope, работа останавливается до обновления
Planning и повторного Gate 1.

### Трассировка PR и candidate

Используйте один `change-id` в Store, связанных задачах, ветках и PR, если это не
противоречит Git-процессу команды. В описании каждого implementation PR укажите:

- Change и исходный запрос;
- Repository и принадлежащие ему Tasks;
- связанные PR других repositories;
- фактические repository checks и известные blockers.

Для gates фиксируйте полные commit SHA и идентификатор собранного build или
deployment, если он используется. Имя ветки, номер задачи или последний commit в PR
не идентифицируют candidate достаточно точно.

Завершение Tasks одного Repository означает только repository completion. Весь Change
готов к Verify лишь после сведения всех запланированных repository results в один
точный candidate.

### Межрепозиторные контракты и порядок

Производные DTO, API clients, OpenAPI/JSON Schema и fixtures в Code Repositories не
становятся независимым источником требований. Сверяйте их с принятыми Specs и
проверяйте как минимум:

- имена и типы полей;
- обязательность и `null`;
- enum и error contracts;
- совместимость версий и миграцию;
- сквозной Scenario через producer и consumers.

Успешный unit- или contract-test одного Repository не доказывает общий Scenario.
Интеграционная/функциональная проверка должна использовать один зафиксированный
candidate.

В `superspec-multirepo` независимые repository scopes можно выполнять параллельно
только когда Plan явно это разрешает и между ними нет общей state, зависимости по
порядку или пересекающихся файлов. Остальные scopes выполняются последовательно.
Rollout выполняйте в порядке, который не создаёт несовместимого состояния между
producer и consumers.

### Change Tracking

Change Tracking опционален. При подключённом Plugin и Agent Extension:

1. Extension начинает attempt перед выбранным каноническим task.
2. Разработчик реализует task, выполняет checks, создаёт commit и устанавливает
   стандартную галочку OpenSpec.
3. Extension завершает attempt и сохраняет planning, base и implementation revisions
   в Change.

Незавершённая attempt хранится локально и не переносится на другую машину.
Завершённая запись публикуется обычным Git-процессом Change. Plugin не назначает
Tasks, не меняет checkbox, branch или PR, не выполняет тесты и не участвует в Verify,
Release или Archive.

Если task возвращён в доработку, снимите стандартную галочку и повторите Apply. Новая
attempt сохраняет новую implementation revision, а прежняя остаётся в истории. Без
Change Tracking команда продолжает обычный Apply и передаёт точные SHA и check
evidence принятым командным каналом. Ручной fallback описан в
[руководстве Plugins](plugins.md).

## Gate 2: candidate принят

Gate 2 относится к точному набору repository commits и поставляемой версии:

- все implementation PR прошли review и обязательные repository checks;
- межрепозиторные contracts и Scenarios проверены на одном candidate;
- Verify содержит свежие фактические результаты;
- человек явно установил Feature Acceptance `PASS`;
- для Superspec Process Compliance равна `PASS` или `PASS_WITH_WARNINGS`, а warnings
  записаны явно;
- drift и дефекты либо устранены через Planning/Apply, либо остаются blocker.

Feature Acceptance `FAIL`, Process Compliance `FAIL` или падающий check возвращает
работу владельцу причины. После исправления собирается новый candidate и проводится
новый Verify. Agent и Plugins не могут принять Gate 2 за человека.

## Gate 3: release ready

До отдельного человеческого Release-решения команда подтверждает:

- Gate 2 относится к выпускаемому candidate;
- блокирующих дефектов нет;
- rollout, наблюдение и rollback готовы;
- обязательные security, migration, SLO и operational approvals получены;
- версия и среда, прошедшие человеческую проверку, однозначно зафиксированы.

Новый commit, build или deployment делает прежнее подтверждение устаревшим: обновите
evidence и повторите Verify и gates для текущего candidate. Успешный Verify сам по
себе не выполняет Release.

## Release и Archive

Сначала выполните фактический Release по правилам проекта. После него запустите
штатный Archive, который применяет Delta Specs к Master Specs и перемещает Change:

```text
/opsx-archive <change-id>
```

При подключённом Graph выполните `openspec-orch plugin exec openspec-graph inspect --json` из Store до и
после Archive. Agent, Orchestrator, Graph и Change Tracking не выполняют Archive
автоматически.

Зависимые Changes архивируйте в dependency order. Если зависимому Change нужен
ранний Sync уже принятого активного Change, оформите Sync отдельным reviewable PR.
Sync не доказывает реализацию или deployment и не заменяет последующий Archive.

Пограничные ситуации собраны в [сценариях работы с Change](change-scenarios.md), а
сокращённый процесс — в [потоке одного человека](solo-flow.md).
