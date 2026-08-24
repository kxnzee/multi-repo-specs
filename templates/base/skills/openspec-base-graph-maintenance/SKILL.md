---
name: openspec-base-graph-maintenance
description: Проверить, пересобрать или точечно обновить явные связи OpenSpec Graph в центральном Store. Использовать, когда пользователь просит диагностировать stale или invalid граф, обновить openspec/graph.yaml после подтверждённого изменения архитектурной связи либо пересобрать производный индекс. Не использовать для редактирования Master Specs, Delta Specs, Cycle или внутренних связей CodeGraph.
---

# Обслуживание OpenSpec Graph

Поддерживать воспроизводимый Store-level граф, не превращая его в отдельный источник
требований. Nodes и выводимые связи принадлежат OpenSpec и реестру Orchestrator;
`openspec/graph.yaml` хранит только явные связи, которые нельзя безопасно вывести.

Быть leaf-skill: не вызывать другие project skills, project commands, subagents или
agents. Работать только в центральном Store и не открывать Code Repositories.

## Границы

- Не изменять `openspec/specs/`, `openspec/changes/`, `openspec-orch.yaml`, Cycle
  Records, Plugin packages, CodeGraph indexes и встроенные `openspec-*` skills или
  `opsx-*` commands.
- Не добавлять relationship по совпадению имён, расположению файлов, предполагаемой
  архитектуре или ребру CodeGraph. Требовать существующие точные node IDs и
  Store-relative evidence `path:line`, которое прямо подтверждает направление связи.
- Не создавать или переписывать evidence-файл только ради прохождения Graph build.
  При отсутствии durable evidence вернуть blocker и запросить решение владельца.
- Не записывать выводимые связи `Store → Repository`, Change/Delta containment и
  Delta Spec → Master Spec `changes` с операциями `ADDED`, `MODIFIED`, `REMOVED` или
  `RENAMED`: Plugin строит их из авторитетных файлов автоматически.
- Сохранять пользовательские и несвязанные изменения в рабочем дереве. Менять только
  запрошенные entries `openspec/graph.yaml`; не сортировать и не форматировать
  остальные entries без необходимости.

## Выбор режима

Выбрать один режим из запроса пользователя:

- `audit` — проверить status, выбранные nodes, evidence и проблему без записи;
- `refresh` — пересобрать только производный Plugin index, не изменяя tracked files;
- `edit` — добавить, изменить или удалить конкретную явную связь и затем пересобрать
  index.

Если запрос только диагностический или решение о связи ещё не принято, использовать
`audit`. Запуск `graph build` изменяет Plugin storage: в `audit` его не выполнять. В
`refresh` или `edit` запуск разрешён только явным запросом пользователя на
пересборку либо изменение графа.

## Проверка перед изменением

1. Подтвердить, что текущий checkout является Store из `openspec-orch.yaml`, и
   проверить Git status. Не искать Store или workspace по файловой системе.
2. Выполнить `openspec-orch graph status --json`. Сохранить `ready`, `stale` или
   `unavailable` как исходное состояние. Отсутствие команды Plugin или Store binding
   классифицировать как `not_configured`, а не как пустой граф.
3. Для `audit` при `ready` использовать `openspec-orch graph inspect <node-id>` для
   каждого выбранного endpoint. При `stale` или `unavailable` не выдавать старый
   index за текущий и ограничиться проверкой точных IDs по авторитетным Store-файлам.
4. Проверить допустимое направление и relation:
   - Repository → Repository: `depends_on`, `calls`, `publishes_to`;
   - Master Spec → Repository: `implemented_by`;
   - Repository → Master Spec: `verifies`;
   - Master Spec → Master Spec: `depends_on`;
   - Delta Spec → Repository: `targets`;
   - Delta Spec → Delta Spec: `depends_on`.
5. Для `calls` и `publishes_to` требовать непустой `contract`. Для любой связи
   проверить хотя бы один существующий обычный Store-файл и точную строку, которая
   прямо подтверждает утверждение. Обратное направление является отдельным решением
   и не выводится автоматически.
6. Проверить отсутствие дубликата с той же тройкой `source + relation + target`.
   Удаление разрешать только для точно выбранной связи и явного решения владельца
   либо подтверждения, что её evidence больше не поддерживает утверждение; не
   удалять соседние edges.

## Изменение и пересборка

В `edit` применить минимальный patch только к `openspec/graph.yaml`. Сохранять
`version: 1` и использовать только поля `source`, `relation`, `target`, необязательный
`contract` и непустой `sources`.

После разрешённого изменения или в режиме `refresh`:

1. Выполнить `openspec-orch graph build`. Команда сама запускает строгую валидацию
   OpenSpec и заменяет index только после успешной проекции.
2. При ошибке не расширять scope исправлений и не обходить валидацию. Если причина
   однозначно находится в изменённой entry, разрешена одна точечная коррекция и один
   повторный build. Иначе отменить только собственный patch этой сессии, сохранить
   чужие изменения и вернуть blocker. В `refresh` tracked files не изменять.
3. Выполнить `openspec-orch graph status --json` и требовать `state: ready`.
4. Для изменённых endpoints выполнить `graph inspect`. Если пользователь указал
   активный Change, дополнительно выполнить `graph impact <change-id>` и показать
   изменение Repository impact. При существующем Cycle проверить его точный набор
   repositories через `graph check-scope`; `CYCLE_NOT_FOUND` только зафиксировать.
   Не создавать и не заменять Cycle автоматически.
5. Перед завершением показать tracked diff `openspec/graph.yaml` и отдельно назвать,
   что Plugin index является локальным производным состоянием и не входит в commit.

## Результат

```yaml
graph_maintenance:
  mode: audit | refresh | edit
  status_before: ready | stale | unavailable | not_configured
  graph_file_changed: true | false
  edges_added: []
  edges_modified: []
  edges_removed: []
  evidence_checked: []
  build: not_run | passed | failed
  status_after: ready | stale | unavailable | not_configured | not_checked
  affected_changes: []
  blockers: []
```

Не объявлять работу завершённой при `build: failed`, неготовом `status_after` либо
неподтверждённом evidence. Человеческое решение о новой архитектурной связи остаётся
внешним Gate; успешный build подтверждает структуру и provenance, но не истинность
самого архитектурного решения.
