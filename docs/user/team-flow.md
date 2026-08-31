# Командный поток и роли

Роли обозначают ответственность, а не ACL Orchestrator. Один человек может совмещать
несколько ролей.

## Ответственность

| Роль | Отвечает за |
|---|---|
| Владелец Change | Intent, scope, критерии успеха, gates и Release |
| Аналитик | Intake, Proposal, Specs и Repository Impact |
| Разработчик | Design, Tasks, implementation и repository checks |
| Тестировщик | Проверяемость Scenarios и evidence текущего candidate |
| Лид | Breaking contracts, security, data migration, SLO и rollout risk |

Лид подключается по риску или политике проекта.

## Поток

```text
Intent и Intake
→ Proposal, Specs, Design и Tasks
→ принятие Planning
→ Apply, PR и repository checks
→ сборка точного candidate
→ IFT/QA и Verify
→ Release
→ Archive
```

Для `superspec-multirepo` команда следует его artifact DAG. Зоны ответственности и
правила проверки candidate остаются теми же.

## Gate 1: Planning принят

До реализации команда подтверждает:

- согласованный Intent и завершённый Intake, если он предусмотрен schema;
- валидные Proposal, Specs, Design и Tasks;
- одинаковый scope в Repository Impact, Design и Tasks;
- план проверки изменённых Scenarios;
- рассмотренные risk triggers.

Изменение поведения, scope или Design требует повторного принятия Planning.

## Реализация нескольких repositories

Каждый implementation PR ссылается на один `change-id` и фиксирует точный commit.
Если во время Apply найден новый Repository или capability, работа останавливается:
Planning, Graph и Gate 1 обновляются до продолжения.

При подключённом Change Tracking разработчик из Code Repository выполняет
`attempt start` перед пунктом Apply, а после commit и стандартной галочки OpenSpec —
`attempt complete`. Незавершённая попытка локальна; завершённая запись попадает в
Change и публикуется вместе с обычным Change PR. Plugin не меняет task status,
branch, PR, Verify или Jira-процесс команды.

## Gate 2: candidate принят

- PR и обязательные repository checks прошли;
- Verify содержит актуальное evidence;
- человек явно установил Feature Acceptance `PASS`;
- технические отклонения согласованы или возвращены в Planning.

## Gate 3: release ready

- Scenarios проверены на том же candidate;
- блокирующих дефектов нет;
- rollout и rollback подтверждены;
- человеческий verification checkpoint закрыт для текущей версии.

Новый commit, build или deployment делает прежнее подтверждение устаревшим.

## Release и Archive

Archive выполняется после фактического Release и штатно применяет Delta Specs к
Master Specs. Зависимые Changes архивируются в dependency order. Ранний Sync
оформляется отдельным reviewable PR и не доказывает реализацию или deployment.
