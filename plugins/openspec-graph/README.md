# OpenSpec Graph Plugin

OpenSpec Graph — Store-only Plugin, который компилирует текущие OpenSpec files в
детерминированный Graph Report. Persisted index и ручная graph metadata отсутствуют.

Graph показывает Store, Repositories, Master Specs, активные/архивные Changes, Delta
Specs и связи из Repository Impact. Он не читает Code Repositories и не доказывает
ownership, реализацию, runtime calls или dependency.

## Подключение и команды

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>

openspec-orch graph inspect
openspec-orch graph inspect --json
openspec-orch graph view --port 0
```

`inspect` печатает report и возвращает ненулевой exit code при errors. `view`
запускает read-only snapshot UI на `127.0.0.1`; изменения файлов требуют перезапуска
команды.

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
