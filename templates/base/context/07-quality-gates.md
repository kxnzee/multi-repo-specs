# Quality gates

Gate — явное решение людей по проверяемому evidence. Skill или subagent может
подготовить review, но не принимает Gate автоматически.

## Gate 1 — Planning accepted

| Evidence | Минимальное условие |
|---|---|
| Jira и Change | Jira Story связана с `change-id` |
| OpenSpec | Proposal, Delta Specs, Design и Tasks согласованы и валидны |
| Scope | Capability, системы и Code Repositories определены |
| Repository impact | По каждому `repository-id` отдельно определены impact, Design scope, Tasks и evidence; релевантный `no-change` обоснован |
| Verification | Каждый новый или изменённый Scenario имеет план проверки |
| Решения | Нет вопроса, меняющего Specs, Design или Tasks |
| Участники | Analyst, Developer и QA; Lead по риск-триггерам |

Результат Gate 1 относится к точной planning revision. Breaking contract,
security/compliance, миграция данных, несколько доменов, изменение SLO или
необратимый rollout требуют Lead Review.

## Gate 2 — Implementation candidate

| Evidence | Минимальное условие |
|---|---|
| PR | Требуемые реализации прошли review и связаны с Change |
| CI | Обязательные автоматические проверки успешны |
| Snapshot | Зафиксированы точные commits всех затронутых репозиториев |
| Artifact | Определён build, image или другой поставляемый результат |
| Deviations | Отклонения от OpenSpec отсутствуют или явно разрешены |

Gate 2 фиксирует кандидата для IFT и QA, но не подтверждает их результат.

## Gate 3 — Release ready

| Evidence | Минимальное условие |
|---|---|
| IFT | Выполнен на Snapshot Gate 2 |
| QA | OpenSpec Scenarios проверены на том же Snapshot |
| Zephyr | Cases и executions связаны со Scenario IDs и Snapshot |
| Defects | Нет блокирующих дефектов |
| Release | Подтверждены rollout, наблюдение и rollback |

## Инвалидация

- Новая planning revision или новый состав репозиториев требует повторного Gate 1.
- Новый implementation commit или artifact инвалидирует Gate 2, IFT, QA и Gate 3.
- Изменение наблюдаемого поведения возвращает Change в Planning.

## Критичные сценарии

<!-- TODO
question: Какие сценарии обязательно проверяются при затрагивающем их изменении?
owner: unassigned
expected_source: Test strategy, maintained requirements, incidents, or CI
-->

## Обязательные проверки

| Проверка | Область | Команда или источник | Условие принятия |
|---|---|---|---|

<!-- TODO
question: Какие проверки и evidence обязательны для принятия изменения?
owner: unassigned
expected_source: CI configuration, test strategy, or maintainer confirmation
-->

## Исключения

Для исключения обязательны причина, владелец решения, scope, срок действия и
компенсирующая проверка. Исключение без владельца или срока блокирует Gate.

<!-- TODO
question: Кто и при каких условиях может принять исключение из quality gate?
owner: unassigned
expected_source: Risk policy or maintainer confirmation
-->
