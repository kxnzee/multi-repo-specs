---
name: change-tracking-apply-context
description: Проверить Cycle, planning revision и repository-scoped Tasks перед штатным OpenSpec Apply, когда Change Tracking подключён. Используется через openspec-base-apply-context.
---

# Change Tracking Apply context

Выполнить только Change Tracking-часть Apply preflight и вернуть проверенный контекст
skill `openspec-base-apply-context`. Не выполнять Graph preflight, не писать код и не
запускать встроенный OpenSpec Apply.

- Использовать только после того, как Base подтвердил подключение Change Tracking для
  текущего workflow.
- Любая ошибка, кроме точного `CYCLE_NOT_FOUND`, означает BLOCKER. Не превращать
  повреждённое или неподтверждённое состояние в standard mode.
- Не создавать Cycle и не выбирать режим без явного решения пользователя.

## Cycle

Выполнить `openspec-orch status <change-id> --json`.

Если status вернул `CYCLE_NOT_FOUND`, предложить:

1. Standard OpenSpec Apply — вернуть исходные contextFiles и Tasks без repository
   filtering, planning pin, Receipts и Snapshot.
2. Orchestrated Apply — остановиться и предложить создать Cycle через
   `openspec-orch assign <change-id> --repo <repository-id>...`, проверить preview и
   закоммитить Cycle Record обычным Git-процессом.

Если Cycle существует, standard mode запрещён. Требовать:

- закоммиченный Cycle Record;
- current_repository с `role: code` и `in_cycle: true`;
- подтверждённую repository identity и OpenSpec pointer;
- Code Repository как первый member персонального Workset, Store как второй.

## Planning integrity

Сравнить текущий Change с `planning_revision` Cycle:

- `exact` — совпадает;
- `progress-only` — отличаются только checkbox уже выбранных Tasks;
- `drift` — любой другой diff.

`drift` блокирует код и возвращает Change в Planning для нового человеческого Gate и
Cycle. Не считать изменение текста, состава или порядка Tasks progress.

## Repository scope

Вернуть полный список repository-id Cycle для последующей сверки с принятым
Repository Impact, но выбрать Tasks только из section с точным current repository-id.
Общая section требует явного owner либо однозначного primary solution owner из Design.

Не выполнять и не отмечать Tasks другого Repository. Не добавлять review Repository в
Cycle автоматически и не объявлять весь Change реализованным по завершению одного
Repository. Blocked Task запрещает completed Result Receipt текущего Repository.

## Handoff

Для Cycle вернуть:

~~~yaml
change_tracking_context:
  mode: orchestrated
  cycle: <cycle-id>
  planning_revision: <sha>
  planning_integrity: exact | progress-only
  repositories: []
  repository: <repository-id>
  selected_tasks: []
  tracking_status: ready | blocked
~~~

После `CYCLE_NOT_FOUND` и явного выбора Standard Apply вернуть:

~~~yaml
change_tracking_context:
  mode: standard
  cycle: null
  planning_revision: null
  planning_integrity: not_applicable
  repositories: []
  repository: null
  selected_tasks: <исходные Tasks без filtering>
  tracking_status: ready
~~~

Не выполнять следующий шаг автоматически: Base продолжает общий Graph preflight и
передаёт готовый scope встроенному OpenSpec Apply.
