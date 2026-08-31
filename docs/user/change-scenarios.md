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
| Change Tracking не подключен | Штатный OpenSpec Apply; evidence передаётся действующим каналом команды |
| Нужен точный набор implementation revisions | После Planning вызвать `track`, не меняя OpenSpec Apply |
| Появился новый implementation commit | Новый `done` → новая собранная версия → повторная проверка/Gates |
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
После валидного Delta Spec выполните `openspec-orch graph inspect --json` и сверьте
Repository Impact с capabilities текущего Change. Не создавайте capability на
основании имени модуля или структуры текущего кода.

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
- выполните общий `graph inspect`; отсутствие Delta Specs принято для этого Change;
- напрямую сверьте Repository Impact, Design и repository sections Tasks;
- сохраните обычные Gate, implementation и verification требования.

## 6. Review-кандидат стал implementation scope

Не добавляйте новый Repository автоматически. Сначала выполните адресную проверку.
Если подтверждено реальное изменение:

1. остановите Apply;
2. добавьте Repository в Proposal Impact, Design и Tasks;
3. обновите Delta Specs, если изменилось поведение/capability;
4. повторите `openspec-orch graph inspect --json` и сверку scope;
5. получите новый Gate 1;
6. при Change Tracking заново зафиксируйте evidence scope командой `track`.

## 7. Apply и опциональный Change Tracking

Apply всегда выполняется штатным OpenSpec по принятым contextFiles и Tasks. Change
Tracking не участвует в выборе Apply и не блокирует его. Если команде нужен общий
Git-native журнал implementation evidence, после Planning отдельно вызовите `track`.
Ошибки Plugin относятся только к этому журналу и не меняют состояние OpenSpec Tasks.

## 8. Начало и обновление сбора evidence

После Gate 1 и commit Planning:

```bash
openspec-orch track <change-id>
```

Команда начинает сбор implementation evidence; состав Code Repositories автоматически
берётся из принятого `Repository Impact`. Она не назначает Tasks и не означает, что
кто-либо взял задачу в работу. Повтор с теми же planning revision и repository set
идемпотентен. Другой scope или revision сразу создаёт новый внутренний Cycle; команда
выводит его ID, но отдельного подтверждения или предупреждения не запрашивает. Прежние
данные остаются в Git/audit-истории, но не считаются текущими.
Команда сама коммитит и публикует evidence scope в Store.

## 9. Заблокированная или неуспешная работа

Фиксируйте незавершённые Tasks, блокировки и результат реализации в нативном workflow
OpenSpec. Не вызывайте `done`, пока Repository не передаёт конкретную implementation
revision в состав проверяемой версии. Plugin не хранит параллельные task-статусы.

## 10. Новый commit после проверки

Любой новый implementation commit требует нового `done`. Каждая новая текущая receipt,
включая исправление при том же SHA, меняет хэш собранной версии, а прежняя проверка
становится нетекущей. Повторите:

1. `done` из изменённого Code Repository;
2. checkout/deployment автоматически собранной точной версии;
3. IFT/QA;
4. `verify pass` или `verify fail`;
5. Gate 2/3 и финальный checkpoint.

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
Release и обязательные Gates. Проверьте Graph Report и prerequisite Changes. После
`/opsx-archive` снова выполните `openspec-orch graph inspect --json` и проверьте
Master Specs и Repository-связи. Зависимые Changes архивируются в dependency order.

## 13. CodeGraph отсутствует или stale

CodeGraph опционален. Если `.codegraph/` отсутствует, stale или runtime недоступен,
используйте адресный read/search в уже выбранном Code Repository. Не запускайте
`codegraph init`/`sync` автоматически и не блокируйте OpenSpec flow. Найденные paths и
symbols подтверждают только текущую реализацию и не копируются в Requirements.
