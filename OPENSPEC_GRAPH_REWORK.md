# Доработка OpenSpec Graph Plugin

Дата фиксации: 2026-08-27

## Контекст

Текущий OpenSpec Graph использует сохраняемый локальный индекс и требует ручной
последовательности `build → status → query`. Перед каждым query Store всё равно
перепроецируется для проверки digest, поэтому persisted cache почти не сокращает
работу, но добавляет отдельный lifecycle и агентское обслуживание
`openspec/graph.yaml`.

В текущем Store ещё нет Master Specs, активных Changes и Archive. Обратная
совместимость с существующей содержательной моделью графа для первого этапа не
требуется.

## Целевая модель

OpenSpec Graph становится автоматической детерминированной компиляцией текущего
Store:

- Store и Repository читаются из `openspec-orch.yaml`;
- Master Specs обнаруживаются в `openspec/specs/**/spec.md`, когда они появятся;
- активные и архивные Changes и Delta Specs обнаруживаются в стандартной структуре
  OpenSpec, когда они появятся;
- отсутствие Specs, Changes или Archive является нормальным состоянием;
- граф компилируется при каждом пользовательском вызове;
- локальный persisted index, freshness digest и состояния `stale`/`unavailable` не
  используются;
- Core остаётся generic, вся логика принадлежит OpenSpec Graph Plugin;
- структурные связи выводятся из расположения и содержимого артефактов Store;
- связь Repository с Master Spec выводится через Change: Change одновременно
  затрагивает capability и явно перечисляет Repository Impact;
- активные и архивные Changes являются источниками связей, поэтому архивирование
  Change не удаляет уже известную связь Repository с Master Spec;
- `openspec/graph.yaml` и отдельная topology metadata не используются;
- семантические типы `implemented_by`, `depends_on` и `calls` удаляются: граф не
  утверждает владение, runtime-вызов или техническую зависимость, если эти сведения
  нельзя детерминированно получить из Store.

## Ноды и связи

Набор нод остаётся прежним:

- `Store`;
- `Repository`;
- `Master Spec`;
- `Change`;
- `Delta Spec`.

Компилятор формирует структурные связи:

- `Store → contains → Repository`;
- `Store → contains → Master Spec`;
- `Store → contains → Change`;
- `Change → contains → Delta Spec`;
- `Change → affects → Master Spec` — по пути Delta Spec;
- `Change → changes_in → Repository` — по структурированному Repository Impact;
- `Repository — linked — Master Spec` — нейтральная производная связь, когда один
  Change связывает конкретный Repository с конкретной capability.

`linked` означает только: «Repository указан в Change, затрагивающем эту Master
Spec». Эта связь не означает `implemented_by`, `calls`, `depends_on` или владение.

Одна пара Repository–Master Spec отображается одной линией. Если связь встречается
в нескольких активных или архивных Changes, источники агрегируются и доступны в
inspector.

Чтобы не создавать ложный cross-product между несколькими Repository и
capabilities одного Change, Repository Impact должен содержать явное соответствие:

```markdown
## Repository Impact

| Repository | Capabilities |
| --- | --- |
| `frontend` | `orders/checkout` |
| `backend` | `orders/checkout`, `payments/processing` |
| `qa` | `payments/processing` |
```

Свободный список Repository без сопоставления с capabilities не используется для
создания прямых Repository–Master Spec связей.

## Master Specs без активных Changes

Master Spec всегда отображается, даже если для неё нет активного Change:

- если связь найдена в архивном Change, Master Spec отображается с обычной связью
  к Repository;
- если связь пока существует только в активном Change, она также отображается, а
  Change остаётся доступным как источник;
- если одна связь подтверждается несколькими Changes, рисуется одна линия со
  списком всех источников;
- если ни в активных, ни в архивных Changes нет Repository Impact для Master Spec,
  нода остаётся в графе и получает warning `UNLINKED_MASTER_SPEC`.

Таким образом, активный Change является временным слоем планирования, а связь
Repository–Master Spec сохраняется как накопленное знание Store после Archive.

## Публичный CLI

Остаются две команды:

```bash
openspec-orch graph inspect
openspec-orch graph inspect --json
openspec-orch graph view
openspec-orch graph view --port 0
```

Удаляются из публичного workflow:

- `graph build`;
- `graph status`;
- `graph impact`;
- `graph check-scope`;
- Plugin `sync` для OpenSpec Graph;
- обязательный pre-query recovery;
- `openspec-graph-maintenance`;
- ручное обслуживание `openspec/graph.yaml`.

## `graph inspect`

Команда компилирует весь Store, проверяет каждую обнаруженную ноду и связь и
печатает подробный отчёт.

```text
OpenSpec Graph inspection

Nodes
[✓] store:specs
[✓] repository:web
[!] change:add-checkout
    Delta Specs ещё не созданы
[!] master-spec:orders/history
    UNLINKED_MASTER_SPEC: связь с Repository не найдена

Edges
[✓] store:specs → contains → repository:web
[✗] change:add-checkout → changes_in → repository:checkout-api
    Repository 'checkout-api' отсутствует в openspec-orch.yaml

Summary
  nodes: 8
  edges: 6
  errors: 1
  warnings: 2
```

Статусы элементов:

- `[✓]` — элемент корректен;
- `[!]` — есть предупреждение, но граф можно использовать;
- `[✗]` — есть ошибка.

Диагностики, которые нельзя привязать к конкретной ноде или связи, выводятся в
отдельной секции `Graph` с кодом, путём, строкой и полем источника.

`graph inspect --json` возвращает полный отчёт:

```json
{
  "state": "invalid",
  "nodes": [],
  "edges": [],
  "diagnostics": [],
  "summary": {
    "nodes": 8,
    "edges": 6,
    "errors": 1,
    "warnings": 2
  }
}
```

При наличии хотя бы одной ошибки `graph inspect` завершается с exit code `1`.
Warnings не меняют успешный exit code.

## `graph view`

Команда компилирует и проверяет тот же текущий Store, но не печатает подробные
списки нод, связей и диагностик. В терминале выводится только общая информация:

```text
OpenSpec Graph
  nodes: 8
  edges: 6
  errors: 1
  warnings: 2

Viewer: http://127.0.0.1:4177
Press Ctrl+C to stop.
```

В viewer:

- корректные элементы отображаются штатно;
- элементы с warning выделяются жёлтым;
- элементы с error выделяются красным;
- inspector показывает связанные diagnostics и точный источник.

Recoverable-ошибки не блокируют запуск viewer: визуализация должна помогать
диагностике. Viewer не запускается только при фатальной ошибке, когда невозможно
сформировать даже частичную модель Store.

## Диагностика компилятора

Компилятор обязан проверять:

- синтаксис и schema структурированных входных файлов;
- уникальность node IDs и relations;
- существование Repository из Repository Impact в `openspec-orch.yaml`;
- существование capability из Repository Impact среди Delta Specs Change;
- однозначность соответствия Repository и capabilities без неявного cross-product;
- существование Master Spec для архивного Change после применения Delta Spec;
- отсутствие конфликтующих и дублирующихся declarations;
- стандартные Delta operations;
- возможность восстановить машинно-читаемый источник каждой производной связи.

Незавершённый Change без Delta Specs является warning, а не ошибкой всего Store.
Master Spec без известной связи с Repository также является warning. Неизвестная
ссылка, неоднозначное сопоставление, конфликт или некорректная структура являются
error.

Каждая производная или объявленная связь должна содержать машинно-читаемый источник:

```json
{
  "path": "openspec/changes/add-checkout/proposal.md",
  "line": 18,
  "field": "repository-impact[0].capabilities[0]"
}
```

## Граница первого этапа

Первый этап сразу включает автоматическую компиляцию Repository–Master Spec связей
из структурированного Repository Impact активных и архивных Changes. Отдельная
topology metadata и агентское обслуживание графа не входят в модель.

Если Store пока содержит только зарегистрированные Repository, граф корректно
состоит из Store, Repository и связей `contains`. Появление Master Specs, Changes и
Archive автоматически расширяет граф без отдельного `build` или миграции индекса.

## Затрагиваемые области реализации

- runtime и команды `plugins/openspec-graph/`;
- тесты Plugin projection, diagnostics и CLI;
- Plugin Template и Agent artifacts;
- Base Template instructions и workflow gates;
- текущая пользовательская и техническая документация.

Изменения не должны добавлять OpenSpec Graph-specific API или ветвления в
`packages/core/`.

## Критерии приёмки

- пустой Store с зарегистрированными Repository успешно проходит `graph inspect`;
- `graph inspect` всегда компилирует текущий Store без предварительного build;
- Repository–Master Spec связь автоматически выводится из структурированного
  Repository Impact и Delta Specs одного Change;
- архивирование Change не удаляет Repository–Master Spec связь;
- Master Spec без активных Changes остаётся видимой;
- Master Spec без известной Repository-связи получает warning
  `UNLINKED_MASTER_SPEC`;
- `implemented_by`, `calls` и `depends_on` отсутствуют в целевой модели;
- human output содержит `[✓]`, `[!]`, `[✗]` и итоговые counts;
- JSON output стабилен и пригоден для автоматизации;
- recoverable diagnostics отображаются в `graph view`;
- fatal parse error не запускает viewer и возвращает понятную диагностику;
- локальный Graph state не создаётся и не читается;
- удалённый lifecycle отсутствует в Agent instructions и документации;
- `npm run check` и `git diff --check` проходят.
