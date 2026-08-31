# Сценарии работы с Change

| Ситуация | Действие |
|---|---|
| Intent уже полон | Перейти к Intake или первому artifact выбранной schema |
| Не хватает продуктового решения | Остановиться и получить решение владельца |
| Нужно проверить текущее состояние | Ограниченный Explore, затем вернуть findings в Planning |
| Новое поведение | `ADDED` Delta Spec |
| Изменение поведения | Полный `MODIFIED` Requirement с сохранёнными Scenario IDs |
| Поведение не меняется | Принятый `skip_specs` и прямая сверка scope |
| Найден новый Repository/capability | Стоп Apply → обновить Planning → новый Gate 1 |
| Нужна связь task с revision | Использовать Change Tracking во время Apply |
| Новый commit после проверки | Обновить evidence и повторить человеческую проверку |
| Change B зависит от активного A | Принять Planning A, отдельный Sync PR, затем Planning B |
| CodeGraph недоступен | Адресный read/search в уже выбранном Repository |
| Реализация и проверка завершены | Release-решение → Archive → post-Archive Graph check |

## Важные правила

- Requirements и Scenarios принадлежат центральному Store.
- Explore подтверждает факты, но не принимает продуктовые решения.
- Repository Impact включает только repositories с реальными изменениями.
- Change Tracking читает task status из OpenSpec Apply, но не изменяет его.
- Verify является человеческой Feature Acceptance по собранному evidence и не
  зависит от Change Tracking.
- Archive не выполняется автоматически Orchestrator или Plugin.
