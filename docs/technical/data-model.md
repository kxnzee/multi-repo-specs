# Данные и состояние

## Классы данных

| Данные | Путь | Владелец | Жизненный цикл |
|---|---|---|---|
| Project configuration | `openspec-orch.yaml` | Пользователь/Core application service | tracked |
| Store identity | `.openspec-store/store.yaml` | OpenSpec | tracked |
| Specs и Changes | `openspec/` | OpenSpec/проект | tracked |
| Cycle Record | `tracking/cycles/<change-id>/cycle.yaml` | Change Tracking через Files facade | tracked |
| Result Receipt journal | `tracking/cycles/<change-id>/receipts/<repository-id>.yaml` | Change Tracking через Files facade | tracked |
| Verification journal | `tracking/cycles/<change-id>/verification/<snapshot-id>.yaml` | Change Tracking через Files facade | tracked |
| Workspace pointer | `.openspec-orch/state.json` | Core | local |
| Plugin state | `.openspec-orch/plugins/<id>/state.json` | Конкретный Plugin через Storage | local |
| External runtime cache | `.openspec-orch/cache/plugin-runtimes/<id>/` | Plugin manager | local |

Tracked и local данные не взаимозаменяемы. Текущее командное состояние Change Tracking
целиком восстанавливается из файлов Store: Snapshot вычисляется из receipt journals и
не требует отдельной локальной базы.

## Project и Repository

Project содержит ровно один Store Repository и Code Repositories. Repository имеет
устойчивый `id`, singleton role, remote и default branch. Plugin declaration хранит
`id` и exact source; binding — ссылка на declaration внутри конкретного Repository.
Project также хранит один Template, один Agent и упорядоченные standalone Extensions
с source `bundled:<id>`. Выбор workflow не является полем Project: OpenSpec хранит
schema каждого Change в `openspec/changes/<change-id>/.openspec.yaml`. Поэтому Change
одного Store могут независимо использовать `spec-driven-extended` и `superspec-multirepo`.

Configuration поддерживает только `version: 2`. Неизвестный format/version — ошибка,
а не best-effort migration.

## Cycle Record

`track` получает `change_id` от CLI, через OpenSpec 1.11 проверяет готовность
`apply.requires` и их транзитивных зависимостей, читает Repository Impact и записывает
внутренний Cycle Record по пути `tracking/cycles/<change-id>/cycle.yaml`. Содержимое:

```yaml
contract_version: 1
cycle_id: cycle-<uuid-v4>
change_id: checkout-flow
planning_revision: <full-store-sha1>
repositories:
  - frontend
  - backend
created_at: <iso-date-time>
```

Current Cycle читается из нормативного файла рабочего дерева Store. После чтения
отдельный Git status этого пути определяет `committed`. Незакоммиченная замена уже
видна status, но блокирует Results и verify.

`planning_revision` фиксирует последний Git commit, изменявший каталог Planning-
артефактов `openspec/changes/<change-id>`. Поэтому собственные tracking-коммиты не
создают новый Cycle, а изменение принятого Planning создаёт новую evidence boundary.
Рабочее дерево должно быть чистым, кроме Cycle path, который текущая операция может
заменить. Cycle — граница evidence, а не состояние OpenSpec Tasks.

## Result Receipt

```yaml
contract_version: 1
receipts:
  - contract_version: 1
    receipt_id: result-<uuid-v4>
    cycle_id: cycle-...
    repository_id: frontend
    implementation_revision: <full-lowercase-sha1>
    source: human
    supersedes: null
    created_at: <iso-date-time>
```

Проверяются current Cycle, membership Repository, допустимый source и существование
commit в локальном checkout выбранного Repository. Task-статуса в Receipt нет.
Несовпадение текущего HEAD с receipt SHA — предупреждение, не ошибка.

Один repository-owned YAML-файл хранит append-only журнал. Новый Result для пары
`cycle_id + repository_id` добавляется с `supersedes`, указывающим на предыдущий
Receipt. Git log и цепочка receipts сохраняют историю без локального state.

## Snapshot

Snapshot вычисляется, когда для каждого Repository текущего Cycle передана
implementation revision. Идентификатор имеет формат
`snap-v1-<64-lowercase-hex>` и вычисляется из:

- версии алгоритма;
- contract version;
- Cycle ID;
- канонически отсортированных троек `repository_id + implementation_revision + receipt_id`.

Время, machine name и local paths в identity не входят. Повтор с теми же входами дает
тот же Snapshot. Новый Receipt, включая исправление с тем же SHA, меняет Snapshot и
делает прежнюю verification нетекущей. Отдельный Snapshot-файл не создаётся.

## Verification Receipt

Verification содержит `pass|fail`, human/CI source, note, Cycle ID, Snapshot ID и
цепочку `supersedes`. Запись разрешена только для последнего Snapshot current Cycle и
добавляется в Git-tracked journal соответствующего Snapshot. Это фиксация результата
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
