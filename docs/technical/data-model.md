# Данные и состояние

## Основные данные

| Данные | Путь | Git | Владелец |
|---|---|---|---|
| Project config | `openspec-orch.yaml` | да | Core |
| Store identity | `.openspec-store/store.yaml` | да | OpenSpec |
| Specs и Changes | `openspec/` | да | OpenSpec/Project |
| Tracking evidence | `tracking/cycles/<change-id>/` | да | Change Tracking |
| Workspace pointer | `.openspec-orch/state.json` | нет | Core |
| Plugin state | `.openspec-orch/plugins/<id>/state.json` | нет | Plugin |
| External runtime cache | `.openspec-orch/cache/plugin-runtimes/<id>/` | нет | Plugin manager |

Project содержит один Store Repository, Code Repositories, один Template, один Agent,
Extensions и Plugin declarations/bindings. Schema Change хранится самим OpenSpec в
`.openspec.yaml`; она не является полем Project.

`openspec-orch.yaml` поддерживает только `version: 2`. Неизвестная версия
отклоняется.

## Change Tracking

### Cycle

`track` создаёт `tracking/cycles/<change-id>/cycle.yaml`:

```yaml
contract_version: 1
cycle_id: cycle-<uuid>
change_id: checkout-flow
planning_revision: <store-sha>
repositories: [frontend, backend]
created_at: <iso-date-time>
```

`planning_revision` — последний commit, изменявший Planning artifacts. Новый
Planning scope создаёт новую evidence boundary. Незакоммиченный Cycle виден в status,
но блокирует receipts и verification.

### Result Receipt

Каждый Repository имеет append-only YAML journal. Текущая запись содержит Cycle ID,
Repository ID, полный implementation SHA, source и ссылку `supersedes` на прежнюю
запись. Task status в Receipt не хранится.

### Snapshot

Когда есть текущий Receipt каждого Repository, Plugin вычисляет
`snap-v1-<sha256>` из Cycle ID и отсортированных Repository/SHA/Receipt ID. Snapshot
не хранится отдельным файлом. Новый Receipt меняет Snapshot даже при том же SHA.

### Verification

Verification journal связывает `pass|fail`, source и note с текущими Cycle и
Snapshot. Это запись результата внешней проверки, а не запуск проверки.

## Plugin storage

Local Plugin payload хранится в versioned envelope. Mutation сериализуется lock-файлом
и завершается atomic replace. Corruption, неизвестная версия и symlink отклоняются.

## OpenSpec Graph

Graph Report содержит Store, Repository, Master Spec, Change и Delta Spec nodes, а
также derived edges. Repository links появляются только из строгой таблицы
Repository Impact того же Change. Каждая derived связь сохраняет provenance
`{ path, line, field }`.

Graph — вычисляемая проекция текущих файлов; persisted index отсутствует.
