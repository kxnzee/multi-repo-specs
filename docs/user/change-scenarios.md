# Сценарии работы с Change

Документ помогает выбрать поддерживаемый маршрут. Во всех сценариях Requirements и
Scenarios принадлежат центральному OpenSpec Store, а Gate принимает человек.

## Быстрый выбор

| Ситуация | Маршрут |
|---|---|
| Intent неполный | `base-intent` → Intake |
| Неизвестно текущее поведение или решение | Intake `explore_recommended` → ограниченный Explore → повторный Intake |
| Добавляется новое наблюдаемое поведение | `ADDED` Delta Spec на новой/принятой capability path |
| Меняется существующее поведение | Delta operation на существующем capability path, обычно `MODIFIED` |
| Поведение не меняется | Принятый `skip_specs`, прямой scope check по Impact/Tasks |
| Во время Apply найден новый Repository/capability | Стоп Apply → Planning → Graph → новый Gate 1 |
| Change Tracking не подключен | Standard Apply после явного выбора |
| Cycle существует | Только orchestrated Apply для текущего Cycle |
| Появился новый implementation commit | Новый Result → новый Snapshot → повторная проверка/Gates |
| Change B зависит от принятого поведения активного A | Planning PR A → отдельный Sync A → Change B |
| Реализация и ручная проверка завершены | Release → Archive → post-Archive Graph handoff |

## 1. Intent уже есть

Если принятая Jira Story или Brief содержит изменение, Why Now, улучшение, критерии
успеха и ограничения, запускайте сразу:

```text
/openspec-base-intake <change-id>
```

Передайте агенту доступное содержание, а не только ссылку. Intake переносит
подтвержденные выводы и спрашивает только пробелы. Повторный `base-intent` не нужен.

## 2. Требуется Explore

Explore подходит для ограниченного исследования, когда вопрос можно разрешить чтением
нормативного источника, Master Spec или адресной проверкой заранее сформулированного
current-state утверждения.

1. Intake фиксирует точные исследуемые вопросы и `explore_recommended`.
2. Человек явно запускает `/opsx-explore`.
3. Findings классифицируются как `CONFIRMED`, `CONTRADICTED`, `UNKNOWN` или `MISSING`.
4. Повторный Intake сохраняет findings и заново выбирает маршрут.

Explore не заменяет решение Владельца. Если требуется продуктовый выбор или
отсутствует нормативный источник, маршрут — `blocked`.

## 3. Новая capability

Proposal перечисляет новую capability, Delta Spec описывает наблюдаемое поведение и
Scenarios, Design фиксирует системные границы, Tasks — реализацию по Repository.
После валидного Delta Spec выполните Graph build/impact/check-scope. Не создавайте
capability на основании имени модуля или структуры текущего кода.

## 4. Изменение существующей capability

Сохраните существующий capability path и выразите изменение стандартной Delta
operation: `ADDED`, `MODIFIED`, `REMOVED` или `RENAMED`. Не создавайте versioned
duplicate или replacement capability для обхода текущей Master Spec.

Для `MODIFIED` включите полное целевое содержание изменяемого Requirement и сохраните
ID retained Scenarios. Ambiguity операции разрешает Владелец Change, итог подтверждает
владелец Specs в Planning PR.

## 5. `skip_specs`

`skip_specs` допустим только когда наблюдаемое поведение не меняется. В этом случае:

- не создавайте фиктивную Delta Spec;
- зафиксируйте принятое обоснование;
- пометьте Graph impact/check-scope как `not_applicable`;
- напрямую сверьте Repository Impact, Design и repository sections Tasks;
- сохраните обычные Gate, implementation и verification требования.

## 6. Review-кандидат стал implementation scope

Graph может вернуть dependent/review Repository. Не добавляйте его автоматически.
Сначала выполните адресную проверку. Если подтверждено реальное изменение:

1. остановите Apply;
2. добавьте Repository в Proposal Impact, Design и Tasks;
3. обновите Delta Specs, если изменилось поведение/capability;
4. пересоберите Graph и повторите scope check;
5. получите новый Gate 1;
6. при Change Tracking создайте новый Cycle.

## 7. Standard Apply без Change Tracking

Если plugin-owned preflight возвращает `CYCLE_NOT_FOUND`, человек выбирает Standard
Apply или создание Cycle. При Standard Apply штатный OpenSpec получает исходные
contextFiles и Tasks. Команда самостоятельно фиксирует набор commits и evidence.

Другие ошибки Change Tracking не разрешают fallback. Нельзя трактовать corruption,
scope mismatch или незакоммиченный Cycle как отсутствие Cycle.

## 8. Создание и замена Cycle

После Gate 1 и commit Planning:

```bash
openspec-orch assign <change-id> --repo <repository-id>...
```

Повтор с теми же planning revision и repository set идемпотентен. Другой scope или
revision создает новый Cycle после предупреждения; Receipts прежнего Cycle остаются в
истории, но не считаются текущими. Cycle Record нужно вручную закоммитить.

## 9. Result `failed` или `blocked`

Запишите фактический статус, не закрывая Tasks:

```bash
openspec-orch record assignment <change-id> \
  --repo <repository-id> --commit <full-sha1> \
  --status blocked --source human --note "причина"
```

`verify` требует текущий `completed` Result для каждого Repository Cycle. Новый
Receipt той же пары Cycle/Repository заменяет текущий с предупреждением и сохраняет
предыдущий в локальной истории.

## 10. Новый commit после проверки

Любой новый implementation commit требует нового Result Receipt. Состав Snapshot
меняется, а прежняя Verification Receipt становится нетекущей. Повторите:

1. `record assignment` для нового SHA;
2. `verify`;
3. checkout/deployment точных версий;
4. IFT/QA;
5. `record verification`;
6. Gate 2/3 и финальный checkpoint.

## 11. Зависимые Changes и ранний Sync

Обычный порядок: реализовать и архивировать A, затем планировать зависимый B. Если B
нужно планировать в том же release до реализации A, разрешен единственный ранний
маршрут:

1. принять и merge Planning PR Change A;
2. из актуальной default branch Store создать отдельную `sync/<change-a>` ветку;
3. выполнить штатный `/opsx-sync <change-a>`;
4. review и merge отдельного Sync PR;
5. создать Change B со ссылками на A и Sync PR.

Change A остается активным. Sync делает принятое целевое поведение нормативной базой
для Planning B, но не доказывает implementation/deployment и не ослабляет Archive.

## 12. Archive

До Archive должны быть завершены все реализации, ручная проверка текущей версии,
Release и обязательные Gates. Проверьте Graph scope и prerequisite Changes. После
`/opsx-archive` обязательно пересоберите Graph и проверьте directly changed Master
Specs. Зависимые Changes архивируются в dependency order.

## 13. CodeGraph отсутствует или stale

CodeGraph опционален. Если `.codegraph/` отсутствует, stale или runtime недоступен,
используйте адресный read/search в уже выбранном Code Repository. Не запускайте
`codegraph init`/`sync` автоматически и не блокируйте OpenSpec flow. Найденные paths и
symbols подтверждают только текущую реализацию и не копируются в Requirements.
