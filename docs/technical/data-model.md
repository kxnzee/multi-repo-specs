# Данные и состояние

## Основные данные

| Данные | Путь | Git | Владелец |
|---|---|---|---|
| Project config | `openspec-orch.yaml` | да | Core |
| Store identity | `.openspec-store/store.yaml` | да | OpenSpec |
| Specs и Changes | `openspec/` | да | OpenSpec/Project |
| Task implementation map | `openspec/changes/<change-id>/implementation-map.yaml` | да | Change Tracking |
| Workspace pointer | `.openspec-orch/state.json` | нет | Core |
| Plugin state | `.openspec-orch/plugins/<id>/state.json` | нет | Plugin |
| External runtime cache | `.openspec-orch/cache/plugin-runtimes/<id>/` | нет | Plugin manager |

Project содержит один Store Repository, Code Repositories, один Template, один Agent,
Extensions и Plugin declarations/bindings. Schema Change хранится самим OpenSpec в
`.openspec.yaml`; она не является полем Project.

`openspec-orch.yaml` поддерживает только `version: 2`. Неизвестная версия
отклоняется.

## Change Tracking

### Implementation attempt

`attempt start` хранит незавершённую попытку в локальном Plugin storage: Change,
Repository, OpenSpec task, schema, planning revision и base revision. В Git эта
запись не попадает. Для одного Change, Repository и task одновременно существует не
более одной активной attempt.

После стандартной отметки task как выполненного `attempt complete` добавляет в
Change-local `implementation-map.yaml` base и implementation revisions. Task ID и
description берутся из канонического OpenSpec Apply JSON, поэтому Plugin не зависит
от имени planning artifact, заголовков Markdown или конкретной schema. Если task
возвращён в работу, следующая попытка добавляется в файл и не перезаписывает предыдущую.

Каждая завершённая запись содержит `repository_id`, канонические `task.id` и
`task.description`, `schema_name`, `planning_revision`, `base_revision`,
`implementation_revision`, `started_at` и `completed_at`. Повтор идентичного completion
не создаёт дубль; новая base или implementation revision считается новой попыткой.

## Plugin storage

Local Plugin payload хранится в versioned envelope. Mutation сериализуется lock-файлом
и завершается atomic replace. Corruption, неизвестная версия и symlink отклоняются.

## OpenSpec Graph

Graph Report содержит Store, Repository, Master Spec, Change и Delta Spec nodes, а
также derived edges. Repository links появляются только из строгой таблицы
Repository Impact того же Change. Каждая derived связь сохраняет provenance
`{ path, line, field }`.

Graph — вычисляемая проекция текущих файлов; persisted index отсутствует.
