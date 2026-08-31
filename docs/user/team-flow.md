# Командный поток и роли

Подробная последовательность ниже относится к schema `spec-driven-extended`. Для
`superspec-multirepo` роли сохраняют те же зоны ответственности и Candidate
Acceptance, но команда следует его artifact DAG Brainstorm → Plan → Apply → Verify →
Finalize из [Project Template](project-template.md), не добавляя Intake или другие
Base-only artifacts.

Роли в этом документе — ответственность в процессе, а не учетные записи или ACL
Orchestrator. Один человек может совмещать несколько ролей. Для маленькой команды
важно не количество людей, а явность решений, evidence и передачи ответственности.

## Допустимые роли

| Роль | Обязательная ответственность | Основные решения/evidence |
|---|---|---|
| Владелец Change | Intent, продуктовый scope, критерии успеха и исключения | Принимает Intent, спорный scope, Gate и Release-решение |
| Аналитик | Intake, Proposal, Delta Specs и сквозная трассировка | Подтверждает Requirements, Scenarios и Repository Impact |
| Разработчик | Реализуемость Design/Tasks и implementation evidence | Коммиты, PR, repository checks, технические отклонения |
| Тестировщик | Проверяемость Scenarios и evidence текущего candidate | План проверки, IFT/QA, pass/fail, блокирующие дефекты |
| Лид | Решения повышенного риска | Breaking contract, security/compliance, миграция данных, несколько доменов, SLO, необратимый rollout |

Лид не обязателен для каждого Change. Он подключается при перечисленных риск-триггерах
или по политике проекта. Неизвестный владелец решения, бессрочное исключение или Gate,
«принятый» только агентом, считаются blocker.

## Разделение ответственности по этапам

| Этап | Ведущий | Обязательные участники |
|---|---|---|
| Intent и Intake | Владелец / Аналитик | Владелец; Лид при раннем риск-триггере |
| Proposal и Specs | Аналитик | Владелец, Тестировщик |
| Design и Tasks | Разработчик / Аналитик | Разработчик, Тестировщик, Лид по риску |
| Graph scope и Gate 1 | Аналитик | Владелец, Разработчик, Тестировщик, Лид по риску |
| Apply и repository checks | Разработчик | Аналитик для вопросов контракта |
| IFT/QA и Gate 2–3 | Тестировщик | Разработчик, Владелец, Лид по риску |
| Release и Archive | Владелец | Тестировщик, Аналитик; Лид по политике |

## Общий flow

```text
Владелец: Intent
    ↓
Аналитик: Intake → Proposal → Specs
    ↓
Разработчик + Тестировщик: Design → Tasks → test plan
    ↓
Команда: Graph scope → Gate 1
    ↓
Разработчики: Apply → PR → repository checks
    ↓
Тестировщик: собранная версия → IFT/QA
    ↓
Команда: Gate 2 → Gate 3 → Release
    ↓
Аналитик/Владелец: Archive → Graph handoff
```

## Gate 1 — Planning принят

До начала реализации команда подтверждает:

- доступный Intent и связь с внешним запросом либо явно зафиксированное отсутствие
  Jira;
- завершенный Intake с разрешенным Planning Route;
- согласованные Proposal, Delta Specs, Design и Tasks;
- строгую OpenSpec validation;
- `graph inspect --json` без errors после Delta Specs;
- одинаковый Repository Impact в Proposal, Design, Tasks и при наличии Cycle;
- план проверки каждого нового/измененного Scenario;
- назначенного владельца финального verification checkpoint;
- закрытые продуктовые и риск-решения.

Gate 1 относится к точной Planning revision. Изменение поведения, scope, Design или
состава/порядка Tasks возвращает Change в Planning и требует нового Gate 1.

## Реализация в нескольких репозиториях

Каждый разработчик работает только с repository section, соответствующей его
`repository-id`. Если во время Apply обнаружен новый Repository или capability,
реализация останавливается: команда обновляет Planning, Graph и Gate 1. Нельзя просто
добавить Repository в Tasks или Cycle.

### Сквозная трассировка

Используйте один `change-id` в Store, связанных задачах, ветках и PR, если это не
противоречит правилам Git hosting команды. В описании каждого implementation PR
укажите Change, исходную задачу и связанные PR других Repository. Для Gate и проверки
фиксируйте точные commits: совпадение имени ветки или номера задачи не идентифицирует
implementation candidate.

### Публичный контракт и производные артефакты

Code Repositories могут хранить производные типы, DTO, API clients, OpenAPI/JSON
Schema и test fixtures. Они не становятся независимым источником требований и должны
создаваться либо проверяться относительно принятого публичного контракта Change.

При межрепозиторной проверке сопоставьте как минимум имена и типы полей,
обязательность, `null`, enum, ошибки и совместимость версий. Успешный unit- или
contract-test одного Repository не доказывает общий пользовательский сценарий:
IFT/QA должны проверить всю затронутую цепочку на одном implementation candidate.

Rollout выполняйте в порядке, не создающем несовместимого состояния. Например, новое
необязательное поле сначала начинает отдавать producer, затем его использует consumer;
удаление старого поведения оформляется отдельным Change после миграции всех клиентов.

OpenSpec workflow реализации не зависит от Change Tracking. Без Plugin точные commits
передаются действующим каналом команды. При подключённом Change Tracking evidence
scope, implementation revisions и проверки публикуются файлами в общем Git Store.
Команды автоматически выполняют необходимую синхронизацию; состояние коллег становится
видимым после pull, а не в real-time.

### Передача частей в Change Tracking

1. После Planning ответственный вызывает `openspec-orch track <change-id>`: команда
   через OpenSpec 1.11 проверяет готовность `apply.requires` и их транзитивных
   зависимостей, затем начинает сбор evidence и фиксирует scope из принятого
   `Repository Impact`. Она не назначает Tasks и не означает начало работы над ними.
2. Разработчики получают Store через Git и видят сводку всех активных Changes командой
   `openspec-orch status`. Ещё не отслеживаемые Changes остаются в списке, а подробный
   evidence одного Change открывается через `openspec-orch status <change-id>`.
3. Каждый реализует свою часть, коммитит и пушит её, затем из чистого Code Repository
   вызывает `openspec-orch done`. Plugin определяет Repository, Cycle и `HEAD`, после
   чего публикует repository-owned receipt. Активные Changes читаются через
   `openspec status --all --json`; при неоднозначности нужен `--change`.
4. Последний `done` автоматически вычисляет точную версию. Если implementation commit
   отсутствует в известных remote-tracking refs, команда предупреждает о риске
   недоступного SHA.
5. Тестировщик читает актуальный `status`, разворачивает указанную версию, выполняет
   проверку и вызывает
   `openspec-orch verify pass --change <change-id>` либо `verify fail`.
   Только актуальный `pass` для текущей версии выводит готовность к человеческому
   решению о выпуске; сам Release команда не выполняет.

`source: human` по умолчанию честно означает человеческое решение. Для CI укажите
`--source ci`. Plugin не делает pass/fail автоматически.

## Gate 2 — implementation candidate

- PR review и обязательные repository checks пройдены;
- точные implementation commits и поставляемый artifact зафиксированы;
- candidate соответствует принятому Change;
- `verify.md` содержит Candidate Acceptance для этой точной версии;
- отклонения либо отсутствуют, либо возвращены в Planning и приняты повторно;
- в Change Tracking flow Gate относится к текущей собранной версии.

## Gate 3 — release ready

- IFT/QA выполнены на том же candidate;
- принятые Scenarios проверены;
- блокирующих дефектов нет;
- Candidate Acceptance в `verify.md` имеет `PASS` и не устарел;
- rollout, наблюдение и rollback подтверждены;
- финальный checkpoint `tasks.md` закрыт человеком для текущей версии;
- в Change Tracking flow результат проверки относится к текущей собранной версии.

## Release и Archive

Archive выполняется только после завершения реализаций, ручной проверки и Release.
Штатный `/opsx-archive` синхронизирует Delta Specs с Master Specs и перемещает Change.
Orchestrator, Graph и Change Tracking не выполняют Archive автоматически.

Если Changes зависят друг от друга, Archive выполняется в dependency order. Early
Sync разрешен только для принятого активного Change A, поведение которого нужно для
Planning Change B: Planning PR A → отдельный `/opsx-sync A` в sync-ветке → Sync PR →
только затем Change B. Sync не доказывает реализацию и не снимает Archive gates.

## Исключения

Каждое исключение фиксирует причину, владельца, область, срок и компенсирующую
проверку. Исключение не может разрешить нарушение машинного контракта, подменить
Requirement или позволить Archive без обязательной реализации и ручной проверки.
