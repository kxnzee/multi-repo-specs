# Change Intake

> Intake сохраняет подтверждённый аналитический контекст Change. Он не является
> принятым Requirement, Scenario, Design decision, ADR, Tasks или evidence реализации.

## 0. Change Profile

<!--
Выберите один или несколько профилей:
- new_integration
- ui_change
- access_security
- existing_behavior_extension
- technical_change
-->

## 1. Jira Story and Sources

<!-- Jira Story, переданные документы и относящийся к Change подтверждённый project context. -->

## 2. Requirements — Analytical Context

### 2.1. General Information

<!--
- проблема или возможность, затронутые пользователи/операторы и Why Now;
- подтверждённое текущее и ожидаемое наблюдаемое поведение;
- Scope, Non-Goals, ограничения и измеримые критерии успеха;
- предварительная продуктовая декомпозиция без превращения её в Tasks.
-->

### 2.2. User or System Journey

<!-- Точка входа, основной путь, результат, альтернативные и негативные ветки. -->

### 2.3. Preliminary Scenarios

<!-- Сценарии в тексте, таблице или PlantUML. Их нормативная версия создаётся в Delta Specs. -->

### 2.4. Public Methods and Interactions

<!--
Публичные методы и направления взаимодействия, внешние зависимости, события/Kafka,
данные, таймауты, ошибки, retry/idempotency и обработка на каждой публичной границе.
Не фиксируйте внутренние implementation details.
-->

### 2.5. UI Section or Page

<!-- Если UI не меняется: Не применимо — <краткая причина>. -->

| Наименование | Компонент | Свойство в структуре данных | Действие | Возможное значение | Примечания |
|---|---|---|---|---|---|
| | | | | | |

Дополнительно опишите состояния loading/empty/error/disabled, соответствие
дизайн-системе и адаптивность.

### 2.6. Additional Scenarios

<!--
Фильтрация, сортировка, пагинация, проверки, тосты/уведомления, уникальные сценарии,
ограничения компонентов и другое поведение, не покрытое выше.
-->

## 3. Pixso or Other Design Sources

<!-- Ссылка, применимые экраны/версии или Не применимо с причиной. -->

## 4. Access Rights

<!-- Если права не меняются: Не применимо — <краткая причина>. -->

| Привилегия | Метод | Роли | Примечание |
|---|---|---|---|
| | | | |

<!-- Укажите согласованное enforcement на UI и gateway/API и поведение при отказе. -->

## 5. Interaction Diagram

<!--
PlantUML sequence diagram обязателен, когда взаимодействуют два или более компонента,
есть внешняя зависимость, асинхронный обмен или значимые error/degraded ветки.
Иначе: Не применимо — <краткая причина>.
-->

## 6. Data, Security, Audit, and Compliance

<!-- Чувствительные данные, маскирование, аудит, compliance и policy/request filtering. -->

## 7. Failure and Degraded Behavior

<!-- Ошибки, таймауты, недоступность зависимостей, recovery и пользовательская обратная связь. -->

## 8. Preliminary System and Repository Impact

<!--
Только предварительные системы/repository-id, где может потребоваться изменение, и
основание такого предположения. Нормативный Repository Impact принимается в Proposal.
-->

## 9. Verification Expectations

<!-- Как команда продемонстрирует ожидаемый результат, включая применимые автотесты. Это не Tasks. -->

## 10. Facts, Assumptions, Conflicts, and Open Questions

### Confirmed Facts

### Assumptions

### Conflicts

### Open Questions

## 11. Exploration

### Status

<!-- not_required | pending | completed -->

### Questions

<!-- Точные вопросы, ради которых нужен Explore. -->

### Findings

<!-- CONFIRMED | CONTRADICTED | UNKNOWN | MISSING; не заполнять догадками. -->

### Decisions and Remaining Unknowns

<!-- Что решено после Explore и что ещё препятствует следующему шагу. -->

### Sources

<!-- Источники, использованные именно во время Explore. -->

## 12. Planning Route

<!--
Ровно одно значение: ready_for_proposal | explore_recommended | blocked.
Добавьте обоснование, точные Explore questions или blocking questions.
-->
