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
| Нужны точные revisions | Подключить Change Tracking после Planning |
| Новый commit после проверки | Новый `done`, deployment и повторная проверка |
| Change B зависит от активного A | Принять Planning A, отдельный Sync PR, затем Planning B |
| CodeGraph недоступен | Адресный read/search в уже выбранном Repository |
| Реализация и проверка завершены | Release-решение → Archive → post-Archive Graph check |

## Важные правила

- Requirements и Scenarios принадлежат центральному Store.
- Explore подтверждает факты, но не принимает продуктовые решения.
- Repository Impact включает только repositories с реальными изменениями.
- Change Tracking не заменяет OpenSpec Apply и не хранит task statuses.
- Verify всегда относится к точной версии candidate.
- Archive не выполняется автоматически Orchestrator или Plugin.
