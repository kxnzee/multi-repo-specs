# OpenSpec Graph Plugin

OpenSpec Graph — Plugin для ролей `store` и `specs`, который компилирует текущие OpenSpec files в
детерминированный Graph Report. Persisted index и ручная graph metadata отсутствуют.

Graph показывает Store, Repositories, Master Specs, активные/архивные Changes, Delta
Specs и связи из Repository Impact. Он не читает Code Repositories и не доказывает
ownership, реализацию, runtime calls или dependency.

## Подключение и команды

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>

openspec-orch plugin exec openspec-graph inspect
openspec-orch plugin exec openspec-graph inspect --json
openspec-orch plugin exec openspec-graph view --port 0
```

`inspect` печатает report и возвращает ненулевой exit code при errors. `view`
запускает read-only snapshot UI на `127.0.0.1`; изменения файлов требуют перезапуска
команды. Основной обзор остаётся снимком на момент запуска; выбранные через
переход командные Store сохраняются после первой успешной загрузки.

Архивные Changes и Delta Specs сохраняются в графе с отметкой «Архив», серым
цветом и пунктирным контуром. Их связи показаны пунктиром; диагностические цвета
ошибок и предупреждений сохраняют приоритет. Имена Changes в графе, деталях,
списках связей и подсказках совпадают с точным `change_id`. На графе отметка «Архив»
расположена отдельной строкой, а в заголовке деталей — отдельным бейджем.
Меню «Фильтры» содержит отдельные переключатели Repositories и Master Specs.
В группе «Изменения» доступны «Активные», «Архивные» и «Показывать их дельта-спеки».
Общего переключателя Changes нет. Состояние фильтрует Change и его Delta Specs,
включая поиск и переходы по связям. Когда оба состояния выключены, переключатель
Delta Specs недоступен; его выбор сохраняется до повторного включения изменений
или сброса фильтров. Master Specs и Repositories
остаются доступны независимо от состояния Changes.
По умолчанию включены только активные Changes, архивные и Delta Specs скрыты; «Сбросить» восстанавливает
этот вид. Для обновления снимка после архивации нужен перезапуск `view`.

## Store другой команды

Основной проект может подключить командный Store как `specs` и привязать к нему
свою установку Graph. Команды выбирают локальный ID подключения:

```bash
openspec-orch plugin connect openspec-graph --repo payments
openspec-orch plugin exec --repo payments openspec-graph inspect --json
openspec-orch plugin exec --repo payments openspec-graph view
```

Graph читает файлы и реестр репозиториев выбранной команды через `targetStore`.
Её код, вложенные Store и пакеты не разворачиваются. Внешний отчёт содержит
`source: { project_id, repository_id, store_id, revision, clean }`. Он описывает
локальный checkout, включая незакоммиченные изменения при `clean: false`.
Сводный граф нескольких Store не строится.

MCP tools `get_spec_graph`, `get_spec_graph_node(node_id)` и
`get_spec_change_impact(change_id)` принимают необязательный `store_repository_id`.
Это локальный ID checkout с ролью `store`/`specs` из реестра основного проекта.
Без него используется основной Store; с ним проверяются binding и поддержка роли.
`node_id` — полный ID узла с префиксом, `change_id` — имя Change без префикса.
Старый `query_graph` заменён этими методами; после обновления нужен restart MCP.
Обогащение основного Change контекстом Graph сохраняет прежний scope.

## Входы

- `openspec-orch.yaml`;
- `openspec/specs/**/spec.md`;
- active и archived Change directories;
- Delta Specs;
- строгая таблица `Repository Impact` в Proposal;
- optional `openspec-graph.yaml`.

Пустой Store с зарегистрированными repositories корректен.

## Repository Impact

Связи Repository–capability создаются только из таблицы:

```markdown
## Repository Impact

| Repository | Capabilities |
|---|---|
| `frontend` | `orders/checkout` |
| `backend` | `orders/checkout`, `payments/processing` |
```

Repository ID должен быть зарегистрирован, а capability — иметь Delta Spec в том же
Change. Свободный текст и дополнительные колонки не интерпретируются.

Связь `linked` означает только участие Repository в Change этой capability. Она не
означает владение или завершённость реализации.

## Graph model

Node types: `store`, `repository`, `master-spec`, `change`, `delta-spec`.

Основные relations: `contains`, `affects`, `changes`, `changes_in`,
`linked`. Derived edges содержат provenance `{ path, line, field }`.

```json
{
  "report_version": 1,
  "graph_version": 1,
  "state": "ready",
  "nodes": [],
  "edges": [],
  "diagnostics": [],
  "summary": {
    "nodes": 0,
    "edges": 0,
    "errors": 0,
    "warnings": 0
  }
}
```

Warnings сохраняют `state: ready`; errors дают `state: invalid`. Recoverable error
оставляет частичный report, fatal error останавливает компиляцию.

## Delta headings

Встроенно поддерживаются `ADDED`, `MODIFIED`, `REMOVED` и `RENAMED`.
Пустой operation-раздел (без содержимого, только с комментарием или `None.`)
сам по себе не создаёт ребро. Формат непустого содержимого Graph не ограничивает.
Aliases полных Markdown headings задаются в optional config:

```yaml
version: 1
operation_headings:
  ADDED:
    - "### Добавленные требования"
```

Aliases дополняют встроенный набор. Некорректный config отбрасывается целиком и
создаёт diagnostic; standard headings продолжают работать.

## Основные diagnostics

Warnings:

- `CHANGE_WITHOUT_DELTA_SPECS`;
- `REPOSITORY_IMPACT_MISSING`;
- `UNLINKED_MASTER_SPEC`.

Errors включают неизвестный Repository/capability, некорректную или дублированную
Repository Impact, отсутствующие/дублированные Delta operations, повреждённую Change
metadata, отсутствующую Master Spec для archived Delta и ошибку strict OpenSpec
validation.

Точные code/message и source location возвращаются в `diagnostics`; потребителю не
следует восстанавливать смысл ошибки по тексту.

## Ограничения

Компиляция полная, не инкрементальная. Исторические links сохраняются только пока
Archive содержит Proposal и Delta Specs. Viewer работает только на loopback и живёт
в процессе команды. Graph Report — навигация и structural validation, а не
implementation evidence.

## Переходы между Store

`view` основного Store показывает подключённые `specs` свёрнутыми узлами.
Клик по спековому репозиторию раскрывает его внутренние узлы и связи на том же
полотне. Повторный клик сворачивает их. Используется обычная раскладка графа;
поиск, фильтры и масштаб при раскрытии сохраняются. «Сбросить» сворачивает все Store.

Для перехода нужны локальный checkout команды и binding `openspec-graph` в
основном проекте. При открытии заново проверяются binding и идентичность Store.
Ошибка показывает причину и ссылку возврата; другие команды остаются доступны.
Источники открываются из соответствующего Store. Вложенные
зависимости команды не разворачиваются. Прямой
`plugin exec --repo <id> openspec-graph view` открывает только выбранный Store.

В viewer кодовые и спековые репозитории имеют независимые фильтры, счётчики
и обозначения: кодовые — синие круги, спековые — бирюзовые ромбы.
Поиск и выбор связанных узлов учитывают оба фильтра; «Сбросить» включает их снова.
Фильтры управляют узлами графа, ссылки переходов между Store остаются доступны.

## Инициатива с участием нескольких команд

В `Repository Impact` Change основного Store можно указать ID подключённых
`specs` наравне с кодовыми репозиториями. Capabilities в таблице относятся к
Delta Specs этого же Change в основном Store, а не к путям внутри команды.

```markdown
| Repository | Capabilities |
| --- | --- |
| `payments` | `customer-refunds` |
| `platform` | `customer-refunds` |
```

Graph выводит участие обеих команд в Change и их связи с общей capability,
сохраняя источники из proposal. Эти связи доступны также через MCP `get_spec_change_impact`
с аргументом `change_id`. Они не определяют порядок работ и не создают Changes
в командных Store. Неизвестный ID репозитория по-прежнему является ошибкой.

## Команды на общем полотне

Данные подключённых Store загружаются при открытии viewer, но их узлы скрыты
до клика по соответствующему репозиторию. Вложенные зависимости не разворачиваются.
Одинаковые имена узлов разных Store разделяются; источники открываются из своего
Store. Ошибка загрузки команды показывается при клике на её узел и не мешает другим.

Объединение относится к viewer. MCP продолжает выдавать отдельные отчёты Store,
а видимые связи участия команд берутся из Repository Impact основного Store.

Запросы отдельной ноды и влияния Change сохраняют `state`, `diagnostics` и `summary`
полного отчёта: наличие найденной ноды не означает, что валидация Store прошла.
Viewer сохраняет предпросмотр исходников вместе со снимком. Каждый подключённый Store
собирается один раз при первой успешной загрузке. Интерфейс получает граф и его
конфигурацию одним ответом, включая ошибки загрузки команд. После изменения файлов перезапустите `view`. Неудавшуюся загрузку можно повторить.
