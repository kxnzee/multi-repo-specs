# Данные и состояние

## Классы данных

| Данные | Путь | Владелец | Жизненный цикл |
|---|---|---|---|
| Project configuration | `openspec-orch.yaml` | Пользователь/Core application service | tracked |
| Store identity | `.openspec-store/store.yaml` | OpenSpec | tracked |
| Specs и Changes | `openspec/` | OpenSpec/проект | tracked |
| Cycle Record | `.openspec-orch/changes/<base64url-change-id>.json` | Change Tracking через Files facade | tracked |
| Workspace pointer | `.openspec-orch/state.json` | Core | local |
| Plugin state | `.openspec-orch/plugins/<id>/state.json` | Конкретный Plugin через Storage | local |
| External runtime cache | `.openspec-orch/cache/plugin-runtimes/<id>/` | Plugin manager | local |

Tracked и local данные не взаимозаменяемы. Потеря local Change Tracking state не
удаляет Cycle, но Results/Snapshots нельзя восстановить без повторного evidence.

## Project и Repository

Project содержит ровно один Store Repository и Code Repositories. Repository имеет
устойчивый `id`, singleton role, remote и default branch. Plugin declaration хранит
`id` и exact source; binding — ссылка на declaration внутри конкретного Repository.
Project также хранит один Template, один Agent и упорядоченные standalone Extensions
с source `bundled:<id>`.

Configuration поддерживает только `version: 2`. Неизвестный format/version — ошибка,
а не best-effort migration.

## Cycle Record

Нормативный путь кодирует исходный `change_id` в UTF-8 base64url без padding.
Содержимое:

```json
{
  "contract_version": 1,
  "cycle_id": "cycle-<uuid-v4>",
  "change_id": "checkout-flow",
  "planning_revision": "<full-store-sha1>",
  "repositories": ["frontend", "backend"],
  "created_at": "<iso-date-time>"
}
```

Current Cycle читается из нормативного файла рабочего дерева Store. После чтения
отдельный Git status этого пути определяет `committed`. Незакоммиченная замена уже
видна status, но блокирует Results и verify.

`planning_revision` фиксирует Store HEAD на `assign`. Рабочее дерево должно быть
чистым, кроме нормативного Cycle path, который текущий assign может заменить.

## Result Receipt

```json
{
  "contract_version": 1,
  "receipt_id": "result-<uuid-v4>",
  "cycle_id": "cycle-...",
  "repository_id": "frontend",
  "implementation_revision": "<full-lowercase-sha1>",
  "status": "completed",
  "source": "human",
  "note": "optional",
  "created_at": "<iso-date-time>"
}
```

Проверяются current Cycle, membership Repository, допустимый status/source и
существование commit в локальном checkout выбранного Repository. Несовпадение его
текущего HEAD с receipt SHA — предупреждение, не ошибка.

Новый Result для пары `cycle_id + repository_id` заменяет текущий с сохранением
предыдущего в local history. `supersedes` в v1 отсутствует.

## Snapshot

`verify` требует `completed` Result каждого Repository Cycle. Идентификатор имеет
формат `snap-v1-<64-lowercase-hex>` и вычисляется из:

- версии алгоритма;
- contract version;
- Cycle ID;
- канонически отсортированных пар `repository_id + implementation_revision`.

Время, machine name и local paths в identity не входят. Повтор с теми же входами дает
тот же Snapshot. Новый Result меняет Snapshot и делает прежнюю verification
нетекущей.

## Verification Receipt

Verification содержит `pass|fail`, source, note, Cycle ID и Snapshot ID. Запись
разрешена только для последнего Snapshot current Cycle. Это фиксация результата
внешней проверки, а не сама проверка.

## Plugin storage envelope

Core storage оборачивает payload Plugin в versioned envelope, сериализует mutation
через lock и заменяет файл атомарно. Plugin владеет schema payload и валидирует ее при
чтении. Corruption приводит к ошибке; тихого сброса или автоматического recovery нет.

Symlink вместо ожидаемого обычного файла/каталога отклоняется. Path разрешается
внутри Store-scoped storage root.

## OpenSpec Graph model

Автоматически выводимые nodes/edges:

- Store, Repositories, Master Specs, Changes, Delta Specs;
- `Store contains Repository`;
- `Store contains Master Spec/Change`;
- `Change contains Delta Spec`;
- `Change affects Master Spec`;
- `Delta Spec changes Master Spec` с Delta operation;
- `Change changes_in Repository` из Repository Impact;
- нейтральная `Repository linked Master Spec` через capability того же Change.

Repository Impact — строгая таблица `Repository | Capabilities` в Proposal. Активные
и архивные Changes агрегируются в `via_changes` прямой связи. Каждая связь содержит
массив `provenance` с машинными источниками `{ path, line, field }`; строковые
`path:line` ссылки не являются частью контракта.

Архивная Delta Spec обязана иметь соответствующую текущую Master Spec. При её
отсутствии компилятор сохраняет placeholder-ноду для диагностики и возвращает
`ARCHIVED_MASTER_SPEC_MISSING`. Каждый Graph Report содержит ноды, связи, diagnostics
и summary, вычисленные из текущих файлов Store.
