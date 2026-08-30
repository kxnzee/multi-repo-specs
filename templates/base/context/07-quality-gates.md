# Quality gates

Gate — явное решение людей по проверяемому evidence. Skill или subagent может
подготовить review, но не принимает Gate автоматически.

## Базовые роли

- **Владелец** подтверждает intent, scope, критерии успеха и открытые продуктовые
  решения.
- **Аналитик** отвечает за согласованность Intake, Proposal, Specs и трассировки.
- **Разработчик** подтверждает реализуемость Design, Tasks и implementation evidence.
- **Тестировщик** подтверждает проверяемость Scenarios и verification evidence.
- **Лид** рассматривает межсистемные, security, migration и необратимые риски.

Project policy назначает людей, допускает совмещение ролей и определяет дополнительные
approvals; базовая роль не означает фиксированную должность или отдельного человека.

## Gate 1 — Planning accepted

| Evidence | Минимальное условие |
|---|---|
| Jira и Change | Jira Story связана с `change-id` |
| OpenSpec | Intake завершён; его маршрут разрешён; Proposal, Delta Specs, Design и Tasks согласованы и валидны |
| Scope | Capability, системы и Code Repositories определены |
| Repository impact | Указаны только `repository-id` с планируемым изменением; для каждого согласованы impact, Design scope, Tasks и evidence |
| Verification | Каждый новый или изменённый Scenario имеет план проверки |
| Решения | Нет вопроса, меняющего Specs, Design или Tasks |
| Участники | Владелец, Аналитик, Разработчик и Тестировщик; Лид по риск-триггерам |

Результат Gate 1 относится к точной planning revision. Breaking contract,
security/compliance, миграция данных, несколько доменов, изменение SLO или
необратимый rollout требуют Lead Review.

## Gate 2 — Implementation candidate

| Evidence | Минимальное условие |
|---|---|
| PR | Требуемые реализации прошли review и связаны с Change |
| Repository checks | В каждом затронутом Code Repository выполнены его локальные обязательные проверки |
| Candidate identity | Зафиксированы точные commits и поставляемый artifact |
| Artifact | Определён build, image или другой поставляемый результат |
| Deviations | Отклонения от OpenSpec отсутствуют или явно разрешены |

Gate 2 фиксирует одного кандидата для IFT и QA, но не подтверждает их результат. Способ
фиксации identity определяется действующим командным процессом.

## Gate 3 — Release ready

| Evidence | Минимальное условие |
|---|---|
| IFT | Выполнен на кандидате Gate 2 |
| QA | OpenSpec Scenarios проверены на том же кандидате |
| Zephyr | Cases и executions связаны со Scenario IDs и identity кандидата |
| Defects | Нет блокирующих дефектов |
| Release | Владелец подтвердил результат; rollout, наблюдение и rollback согласованы, Лид привлечён по риск-триггерам |

## Инвалидация

- Новая planning revision или новый состав репозиториев требует повторного Gate 1.
- Новый implementation commit или artifact инвалидирует кандидата Gate 2, IFT, QA и
  Gate 3.
- Изменение наблюдаемого поведения возвращает Change в Planning.

## Критичные сценарии

<!-- TODO
question: Какие сценарии обязательно проверяются при затрагивающем их изменении?
owner: unassigned
expected_source: Test strategy, maintained requirements, incidents, or CI
-->

Локальные команды build/test/lint, CI-конфигурация и технические критерии хранятся в
соответствующих Code Repositories и не дублируются в Store.

## Исключения

Для исключения обязательны причина, владелец решения, scope, срок действия и
компенсирующая проверка. Исключение без владельца или срока блокирует Gate.

<!-- TODO
question: Кто и при каких условиях может принять исключение из quality gate?
owner: unassigned
expected_source: Risk policy or maintainer confirmation
-->
