---
name: openspec-base-graph-maintenance
description: Проверить или точечно обновить подтверждённые явные связи OpenSpec Graph в центральном Store. Использовать для аудита, добавления, изменения или удаления конкретной explicit edge в openspec/graph.yaml. Не использовать как общий способ routine refresh и не редактировать Master Specs, Delta Specs, Cycle или внутренние связи CodeGraph.
---

# Обслуживание OpenSpec Graph

- ОБЯЗАН работать только с одной явно запрошенной explicit edge и подтверждённым
  Store-relative evidence.
- ЗАПРЕЩЕНО угадывать relation, автоматически расширять scope, открывать Code
  Repository или исправлять соседние данные ради успешного build.
- Нет точного node ID, evidence, ready/authoritative Graph или разрешённого edit — это
  BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ и не создавай приблизительную связь.

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
- `edit` — добавить, изменить или удалить конкретную явную связь и затем пересобрать
  index.

Если запрос только диагностический или решение о связи ещё не принято, использовать
`audit`. Обычный recovery/build производного индекса выполняется до query по
корневому Graph lifecycle и не является отдельным режимом этого skill. В `edit`
повторный build обязателен после изменения tracked graph file.

## Проверка перед изменением

1. Подтвердить, что текущий checkout является Store из `openspec-orch.yaml`, и
   проверить Git status. Не искать Store или workspace по файловой системе.
2. Выполнить `openspec-orch graph status --json` и сохранить исходное состояние. При
   `stale` или `unavailable` выполнить точный `next_command`, повторить status и
   продолжить только при `ready` и `authoritative: true`. При `invalid`, отсутствии
   команды/binding (`not_configured`) или неготовом повторном status вернуть blocker;
   не читать last-known-good или YAML как обход.
3. Для `audit` использовать `openspec-orch graph inspect <node-id>` для каждого
   выбранного endpoint только после готового preflight.
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

После разрешённого изменения:

1. Выполнить `openspec-orch graph build`. Команда сама запускает строгую валидацию
   OpenSpec и заменяет index только после успешной проекции.
2. При ошибке не расширять scope исправлений и не обходить валидацию. Если причина
   однозначно находится в изменённой entry, разрешена одна точечная коррекция и один
   повторный build. Иначе отменить только собственный patch этой сессии, сохранить
   чужие изменения и вернуть blocker.
3. Выполнить `openspec-orch graph status --json` и требовать `state: ready`.
4. Для изменённых endpoints выполнить `graph inspect`. Если пользователь указал
   активный Change, дополнительно выполнить `graph impact <change-id>` и показать
   изменение Repository impact. Если Change Tracking объявлен и подключён, при
   существующем Cycle проверить его точный набор repositories через
   `graph check-scope`; `CYCLE_NOT_FOUND` только зафиксировать. Если Change Tracking не
   подключён, не вызывать его команды и не считать отсутствие Cycle ошибкой.
   Не создавать и не заменять Cycle автоматически.
5. Перед завершением показать tracked diff `openspec/graph.yaml` и отдельно назвать,
   что Plugin index является локальным производным состоянием и не входит в commit.

## Результат

```yaml
graph_maintenance:
  mode: audit | edit
  status_before: ready | stale | invalid | unavailable | not_configured
  graph_file_changed: true | false
  edges_added: []
  edges_modified: []
  edges_removed: []
  evidence_checked: []
  build: not_run | passed | failed
  status_after: ready | stale | invalid | unavailable | not_configured | not_checked
  affected_changes: []
  blockers: []
```

Не объявлять работу завершённой при `build: failed`, неготовом `status_after` либо
неподтверждённом evidence. Человеческое решение о новой архитектурной связи остаётся
внешним Gate; успешный build подтверждает структуру и provenance, но не истинность
самого архитектурного решения.
