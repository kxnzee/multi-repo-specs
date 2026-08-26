---
name: openspec-base-apply-context
description: Подготовить standard или repository-scoped orchestrated контекст штатного OpenSpec Apply. Не заменяет встроенный openspec-apply-change и не создаёт отдельный implementation workflow.
---

# Apply context

- ОБЯЗАН выполнить весь preflight до передачи управления встроенному Apply.
- ЗАПРЕЩЕНО писать код, обходить Cycle, подменять ошибку fallback-режимом или
  продолжать при неподтверждённом Repository scope.
- Любое невыполненное обязательное условие означает BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ;
  не угадывай значение и не расширяй scope.

Быть leaf-skill: не вызывать project skills, commands или subagents. Передать
проверенный scope встроенному OpenSpec Apply.

## Preflight

1. Получить Change через openspec status --change <change-id> --json и
   openspec instructions apply --change <change-id> --json. Использовать возвращённые
   paths, contextFiles и Tasks.
2. По openspec-orch.yaml определить, объявлен ли Change Tracking и подключён ли он для
   текущего workflow. ЗАПРЕЩЕНО определять это пробным вызовом отсутствующей команды.
3. Если Change Tracking не подключён, выбрать standard mode и не вызывать его команды.
4. Если Change Tracking подключён, выполнить openspec-orch status <change-id> --json.
   Успешный Cycle включает orchestrated mode. Только CYCLE_NOT_FOUND разрешает выбор
   standard/orchestrated. Любая другая ошибка блокирует Apply.

При Cycle требовать:

- закоммиченный Cycle Record;
- current_repository с role code и in_cycle: true;
- подтверждённую repository identity и OpenSpec pointer;
- Code Repository как первый member персонального Workset, Store как второй.

## Standard mode или Change без Cycle

Если Change Tracking не подключён, продолжить Standard OpenSpec Apply без Cycle. Не
представлять отсутствие Plugin или binding как ошибку и не создавать их автоматически.

Если Change Tracking подключён, но status вернул CYCLE_NOT_FOUND, предложить два
варианта:

1. Standard OpenSpec Apply — без repository scope, planning pin, Receipts и Snapshot.
2. Orchestrated Apply — остановиться и создать/закоммитить Cycle через
   openspec-orch assign.

Не создавать Cycle автоматически. В standard mode вернуть исходные
contextFiles/Tasks встроенному Apply без repository filtering. Существующий Cycle
нельзя обходить standard mode.

## Planning integrity

В orchestrated mode сравнить текущий Change с planning_revision Cycle:

- exact — совпадает;
- progress-only — отличаются только существующие checkbox выбранных Tasks;
- drift — любой другой diff.

drift блокирует код и возвращает Change в Planning для нового человеческого Gate и
Cycle. Не считать изменение текста, состава или порядка Tasks progress.

В standard mode planning_integrity пометить как not_applicable: Change Tracking pin
отсутствует, и skill ЗАПРЕЩЕНО имитировать его ручным сравнением.

## Graph и repository scope

1. Выполнить status → recovery → status OpenSpec Graph и требовать ready,
   authoritative.
2. Для Change с Delta Specs выполнить graph impact <change-id>.
3. Выполнить graph check-scope <change-id>:
   - в orchestrated mode передать каждый repository-id Cycle отдельным --repo;
   - в standard mode передать каждый repository-id принятого Repository Impact и
     repository sections Tasks отдельным --repo.
4. Для явно принятого skip_specs без Delta Specs зафиксировать Graph impact и scope как
   not_applicable и проверить Repository Impact/Tasks напрямую. Не создавать фиктивную
   Delta Spec.
5. missing required/delta specs, unmapped master specs, included review repository,
   extra repository или неразрешённый review outside scope блокируют Apply. Review
   repositories не добавлять в Cycle или standard implementation scope автоматически.
6. Классифицировать current repository как direct, review или extra, когда текущий
   контекст относится к зарегистрированному Code Repository.

В orchestrated mode выбрать Tasks только из section с точным current repository-id.
Общая section требует явного owner либо однозначного primary solution owner из Design.
Не выполнять и не отмечать Tasks другого Repository. В standard mode не вводить
repository filtering: передать встроенному Apply исходный набор Tasks.

## Навигация и evidence

До кода проверить Git root, repository-id, полный HEAD и пользовательский worktree.
Не очищать чужие изменения.

CodeGraph разрешён только внутри current repository и только при ready index на той
же revision. Иначе использовать адресный read/search. Не запускать sync автоматически
и не считать Graph evidence реализации.

Перед checkbox сформировать:

~~~yaml
task_evidence:
  task_id: <id>
  claim: <проверяемый результат>
  artifacts: []
  checks: []
  status: satisfied | blocked
~~~

Отмечать Task только при satisfied:

- artifacts непосредственно подтверждают результат;
- реально выполненные checks перечислены с результатом;
- требуемый тест существует, проверяет заявленное поведение и прошёл;
- план проверки или рассуждение не выдаются за выполненную verification.

Blocked Task остаётся незакрытой и запрещает completed Result Receipt текущего
Repository. Proposal, Specs, Design и текст Tasks во время Apply не изменять.

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
