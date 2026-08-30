---
name: openspec-base-apply-context
description: Подготовить общий контекст штатного OpenSpec Apply, выбрать standard mode или передать Change Tracking его plugin-owned preflight. Не заменяет встроенный openspec-apply-change.
---

# Apply context

- ОБЯЗАН выполнить общий preflight до передачи управления встроенному Apply.
- ЗАПРЕЩЕНО писать код, подменять ошибку fallback-режимом или продолжать при
  неподтверждённом Repository scope.
- Любое невыполненное обязательное условие означает BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ;
  не угадывай значение и не расширяй scope.

Это единый project entrypoint Apply. Он может передать только Change Tracking-часть
установленному skill `change-tracking-apply-context`; не дублировать его правила и не
вызывать другие project skills, project commands или subagents.

## Общий preflight и выбор режима

1. Получить Change через `openspec status --change <change-id> --json` и
   `openspec instructions apply --change <change-id> --json`. Использовать возвращённые
   paths, contextFiles и Tasks.
2. По `openspec-orch.yaml` определить, объявлен ли Change Tracking и подключён ли он для
   текущего workflow. ЗАПРЕЩЕНО определять это пробным вызовом отсутствующей команды.
3. Если Change Tracking не подключён, выбрать standard mode и не вызывать его команды
   или skill.
4. Если Change Tracking подключён, передать `change-id`, исходные contextFiles и Tasks
   установленному `change-tracking-apply-context`. Отсутствующий plugin-owned skill —
   BLOCKER: Plugin installation неполна; не имитировать его проверки в Base.
5. Продолжать только с `tracking_status: ready`, возвращённым plugin-owned skill. Его
   `mode`, Cycle context, repository list и selected Tasks считать входом общего
   Graph preflight, но не переопределять.

## Standard mode

В standard mode продолжить без repository filtering, planning pin, Cycle, Receipts и
Snapshot. Вернуть встроенному Apply исходные contextFiles и Tasks.

Отсутствие Change Tracking или binding не является ошибкой. Не устанавливать и не
подключать Plugin автоматически. Если подключённый Plugin после `CYCLE_NOT_FOUND`
вернул standard mode по явному выбору пользователя, применять те же правила.

## Graph и repository scope

1. Выполнить `openspec-orch graph inspect --json` и требовать `errors: 0`.
2. Проверить, что Repository Impact использует строгую таблицу
   `Repository | Capabilities`, все repository-id зарегистрированы, а capability paths
   имеют Delta Specs текущего Change.
3. В orchestrated mode сравнить `repositories`, возвращённые Change Tracking, с
   Repository Impact и repository sections Tasks. В standard mode сравнить эти два
   Planning-источника напрямую.
4. Для явно принятого `skip_specs` без Delta Specs проверить Repository Impact и Tasks
   напрямую; не создавать фиктивную Delta Spec.
5. Любая Graph error, неизвестный Repository/capability или расхождение принятого
   implementation scope блокирует Apply. `UNLINKED_MASTER_SPEC` остаётся warning и
   требует явного review, но не создаёт Repository автоматически.
6. Классифицировать current repository как входящий или не входящий в принятый
   Repository Impact, когда текущий контекст относится к Code Repository.

В orchestrated mode использовать только selected Tasks, возвращённые Change Tracking.
В standard mode не вводить repository filtering: передать встроенному Apply исходный
набор Tasks.

## Навигация и evidence

До кода проверить Git root, repository-id, полный HEAD и пользовательский worktree. Не
очищать чужие изменения.

CodeGraph разрешён только внутри current repository и только при ready index на той же
revision. Иначе использовать адресный read/search. Не запускать sync автоматически и не
считать Graph evidence реализации.

Перед checkbox сформировать:

~~~yaml
task_evidence:
  task_id: <id>
  claim: <проверяемый результат>
  artifacts: []
  checks: []
  status: satisfied | blocked
~~~

Отмечать Task только при `satisfied`:

- artifacts непосредственно подтверждают результат;
- реально выполненные checks перечислены с результатом;
- требуемый тест существует, проверяет заявленное поведение и прошёл;
- план проверки или рассуждение не выдаются за выполненную verification.

Blocked Task остаётся незакрытой. Proposal, Specs, Design и текст Tasks во время Apply
не изменять.

## Результат

Перед Apply:

~~~yaml
apply_scope:
  change: <change-id>
  mode: standard | orchestrated
  cycle: <cycle-id|null>
  planning_revision: <sha|null>
  planning_integrity: exact | progress-only | not_applicable
  graph_status: ready | not_applicable
  repository: <repository-id|null>
  repository_impact: direct | review | extra | not_applicable
  code_navigation: codegraph | fallback | not_applicable
  selected_tasks: []
  scope_status: ready | blocked
~~~

После repository scope:

~~~yaml
repository_completion:
  repository: <repository-id>
  satisfied_tasks: []
  blocked_tasks: []
  checks: []
  completion_status: completed | incomplete
~~~

Не объявлять весь Change реализованным по завершению одного Repository.
