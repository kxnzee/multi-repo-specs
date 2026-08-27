# Командный поток и роли

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
Тестировщик: candidate/Snapshot → IFT/QA
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

В Standard flow точные commits передаются действующим каналом команды. В Change
Tracking flow каждый Result Receipt локален. Разработчик может записать его на своей
машине, но тестировщику все равно потребуется полный SHA, потому что Receipts не
переносятся между машинами.

### Передача SHA в Change Tracking v1

1. Аналитик создает и коммитит Cycle Record в Store.
2. Разработчики получают Store через Git и видят Cycle командой
   `openspec-orch status <change-id>`.
3. Каждый реализует свою часть, пушит commit и передает полный SHA обычным каналом.
4. Тестировщик fetch-ит commits и записывает Results локально:

   ```bash
   openspec-orch record assignment <change-id> \
     --repo frontend --commit <full-sha1> \
     --status completed --source human \
     --note "SHA от разработчика, PR #42"
   ```

5. Тестировщик вызывает `verify`, разворачивает/checkout-ит точные версии Snapshot,
   выполняет проверку и записывает Verification Receipt.

`source: human` честно означает ручной перенос подтвержденного SHA; он не делает
Receipt автоматически полученным из CI.

## Gate 2 — implementation candidate

- PR review и обязательные repository checks пройдены;
- точные implementation commits и поставляемый artifact зафиксированы;
- candidate соответствует принятому Change;
- отклонения либо отсутствуют, либо возвращены в Planning и приняты повторно;
- в Change Tracking flow Gate относится к текущему Snapshot.

## Gate 3 — release ready

- IFT/QA выполнены на том же candidate;
- принятые Scenarios проверены;
- блокирующих дефектов нет;
- rollout, наблюдение и rollback подтверждены;
- финальный checkpoint `tasks.md` закрыт человеком для текущей версии;
- в Change Tracking flow Verification Receipt относится к текущему Snapshot.

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
