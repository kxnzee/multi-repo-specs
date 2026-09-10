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
| Package manifest | `.openspec-orch/packages/package.json` | да | Package supply |
| Package lock | `.openspec-orch/packages/package-lock.json` | да | npm |
| External runtime | `.openspec-orch/packages/node_modules/` | нет | npm |

Project содержит один Store Repository, Code/Specs Repositories, один Template, один Agent,
Extensions и Plugin declarations/bindings. Schema Change хранится самим OpenSpec в
`.openspec.yaml`; она не является полем Project.

`openspec-orch.yaml` поддерживает только `version: 1`. Неизвестная версия
отклоняется.

Для Specs Repository локальный `id` идентифицирует подключение, а `store_id`
фиксирует ожидаемую идентичность внешнего Store. Binding относится к локальному
`id` в основном проекте. Роль относительна: этот же репозиторий имеет роль `store`
в собственном проекте. Реестр внешнего Store читается без рекурсивного подключения.

## Change Tracking

### Карта реализации

`implementation-map.yaml` использует единый формат `contract_version: 1` с полями
`change_id`, `attempts` и `implementations` с первой записи. Поле `implementations`
содержит связи по ключу
`repository_id + task.id + pull_request`: канонические `task.id/description`,
`schema_name`, `pull_request`, `plan_url`, `commits`, `summary`, `remaining`, `version`.
Это текущие снимки для передачи работы, а не журнал локальных событий. Детальный
план находится в PR. Абсолютные пути checkout и копия checkbox не сохраняются.

`expected_version` предотвращает потерю конкурентного обновления той же связи.
Повтор идентичного запроса не повышает версию. CLI/MCP проверяют точное описание
задачи и наличие явных SHA через публичный Git facade. Состояние галочки вычисляется
при чтении; изменённое соответствие задачи возвращается как `changed_or_missing`.
Чтение карты не изменяет файл. `record_implementation` не пишет Plugin storage.

PR URL нормализуется через URL parser без fragment; query сохраняется. `plan_url`
сохраняет адрес технического плана с fragment. Дубли после нормализации считаются
конфликтом данных и требуют явного разрешения, а не молчаливого удаления записей.
`previous_task_id` вместе с `expected_version` явно переносит одну связь того же PR
к актуальной задаче; это аргумент операции, а не новое поле файла.

Обзор возвращает все канонические `tasks` с краткими ссылками на реализации и
предупреждениями. `implementations` сохраняет также устаревшие связи для разрешения.
Повреждение legacy storage возвращается в `legacy_error`, не блокируя корректную
карту; `active/cancelled: null` обозначает неизвестное состояние.

### Implementation attempt (совместимость)

`attempt start` хранит незавершённую попытку в локальном Plugin storage: Change,
Repository, OpenSpec task, schema, planning revision и base revision. В Git эта
запись не попадает. Для одного Change, Repository и task одновременно существует не
более одной активной attempt.

`attempt cancel` снимает только выбранную активную попытку и сохраняет
`{ attempt, reason, cancelled_at }` в `cancelled_attempts` локального Plugin storage.
Он не создаёт implementation evidence. Формат локального состояния v2 содержит
`contract_version`, `active_attempts`, `cancelled_attempts`; состояние v1 читается
совместимо и преобразуется при успешной записи. Read-only status не выполняет миграцию.
Отмена и завершение сериализованы той же локальной блокировкой storage.

После стандартной отметки task как выполненного `attempt complete` добавляет в
Change-local `implementation-map.yaml` base и implementation revisions. Task ID и
description берутся из канонического OpenSpec Apply JSON, поэтому Plugin не зависит
от имени planning artifact, заголовков Markdown или конкретной schema. Если task
возвращён в работу, следующая попытка добавляется в файл и не перезаписывает предыдущую.

Каждая завершённая запись содержит `repository_id`, канонические `task.id` и
`task.description`, `schema_name`, `planning_revision`, `base_revision`,
`implementation_revision`, `started_at` и `completed_at`. Повторная запись того же
completion после сбоя локальной очистки не создаёт дубль. После успешной очистки
повторный CLI-вызов без новой активной attempt возвращает `ATTEMPT_NOT_FOUND`; новая
base или implementation revision считается новой попыткой.

## Plugin storage

Local Plugin payload хранится в versioned envelope. Mutation сериализуется lock-файлом
и завершается atomic replace. Corruption, неизвестная версия и symlink отклоняются.

## OpenSpec Graph

Graph Report содержит Store, Repository, Master Spec, Change и Delta Spec nodes, а
также derived edges. Repository links появляются только из строгой таблицы
Repository Impact того же Change. Каждая derived связь сохраняет provenance
`{ path, line, field }`.

Graph — вычисляемая проекция текущих файлов; persisted index отсутствует.
Для роли `specs` отчёт и результаты запросов содержат `source` с `project_id`,
`repository_id`, `store_id`, `revision` и `clean`. Поля `revision` и `clean` равны
`null`: Graph не читает Git и всегда включает текущее содержимое файлов.
MCP `content_revision` вычисляется по содержимому, а не по HEAD.
