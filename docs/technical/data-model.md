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

Один файл `openspec/changes/<change-id>/implementation-map.yaml`, одна запись на
`repository_id + task_id`:

```yaml
contract_version: 1
change_id: payment-retry
implementations:
  - repository_id: backend
    task_id: "4"
    planning_revision: <store-commit>
    planning_fingerprint: <automatic-sha256>
    base_revision: <code-commit-before>
    implementation_revision: <code-commit-after>
    state: partial
    note: "Осталось проверить UI"
```

Revisions и fingerprint получает Plugin, не вызывающий агент. `state` равен
`partial` или `complete`; `note` необязательна и используется только для checkpoint.
Галочка не копируется в карту: она читается из OpenSpec. Описания, схема, PR,
списки коммитов, timestamps и версии отдельных записей в карте отсутствуют.

`planning_fingerprint` защищает позиционный task ID от повторного использования
после изменения плана: хешируются схема и полные входы Apply, включая
`apply.tracks`. Галочки и окончания строк нормализуются. Изменение любого
входа консервативно делает прежние записи устаревшими; Verify не входит в отпечаток,
если активная схема не объявляет его входом Apply.

Обновление выполняется под файловой блокировкой с атомарной заменой. Plugin
сравнивает запись с автоматически запомненным fingerprint; устаревший автор не
может перезаписать новый результат той же задачи. Разные записи объединяются,
идентичный результат не создаёт дубль. Чтение не меняет карту. Повреждение карты
блокирует операции; повреждение локального состояния не скрывает исправную карту.

### Локальная запись работы

Plugin storage содержит `{ contract_version: 1, sessions: [...] }`. Сессия хранит
Change/Repository/task, `checkout_path`, planning revision/fingerprint, base revision,
`observed`, `last_saved` и `active`. Последние поля — внутренние маркеры конкурентной
записи и повторного вызова, их не передают через CLI/MCP и не публикуют в Store.

`start` создаёт сессию или продолжает опубликованный checkpoint на его точном
commit. Для передачи не нужен исходный checkout или его storage. Checkpoint
оставляет сессию активной; complete сохраняет локальный маркер для безопасного
повтора. Cancel удаляет запись только вызывающего checkout, не трогая карту.
Отмена и сохранение сериализованы одной локальной блокировкой.

Карта хранит последнее соответствие, а не журнал попыток. Перезапись истории
или изменение плана требуют явного `start --restart` после проверки scope.
Старые форматы не поддерживаются: это первая версия контракта.

### Проверяемый кандидат

Отчёт Tracking — вычисляемое представление, а не новое хранилище. `summary`
разделяет `total_tasks`, `completed_tasks` (галочки OpenSpec) и `recorded_tasks`
(задачи с complete во всех известных связях). Задача в нескольких репозиториях
считается один раз. При недоступном Apply счётчики равны `null`, соответствие
записей имеет состояние `unknown`, а не `stale` или complete.

Строки получают `message`, `next_step` и `needs_attention` из прочитанных фактов.
`task_id` ограничивает строки, но не сводку и candidate всего Change; добавляемый
`context` содержит реальные пути из активной схемы, без угадывания Repository.
Краткий MCP-ответ скрывает revisions, candidate и диагностические подробности
предупреждений. `details: true` раскрывает их; операции записи возвращают краткий
результат и следующий шаг без новых чтений после успешной записи.

`status <change-id> --json` возвращает `candidate`: снимок текущих checkout известных Tracking
репозиториев. Это не Verify receipt и не доказательство полноты Repository Impact.
Агент сохраняет ответ отдельным evidence-артефактом до проверки и ссылается на него
из Verify; новые записи карты не меняют ранее проверенный снимок.

`status --all` возвращает `changes[]` по списку активных Changes OpenSpec. Каждый
элемент содержит `change_id`, `summary`, `checkpoints` (пары Repository/task),
`attention` (задачи с замечаниями и следующим шагом) и `warnings`. Архив и оставшиеся
локальные записи не расширяют список. При недоступных данных `checkpoints: null`,
а не пустой список. Один недоступный Change не скрывает остальные.

Опциональный `diff` строки задачи вычисляется от её `implementation_revision` до
текущего HEAD Repository. `committed_files` — итоговая разница файлов между двумя
коммитами, не журнал всех касаний; переименование представлено старым и новым путём.
`worktree_files` отдельно содержит незакоммиченные, включая untracked. У недоступного
сравнения `available: false`, а не нулевые счётчики. Обычный MCP-ответ скрывает
`from_revision`, `to_revision` и подробности ошибки. Эти отчёты не сохраняются в карту.

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
