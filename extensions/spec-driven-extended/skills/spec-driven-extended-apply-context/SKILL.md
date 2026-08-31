---
name: spec-driven-extended-apply-context
description: Подготовить нейтральный repository scope для штатного OpenSpec Apply по принятым Planning-артефактам. Не заменяет встроенный openspec-apply-change.
---

# Apply context

- ОБЯЗАН выполнить общий preflight до передачи управления встроенному Apply.
- ЗАПРЕЩЕНО писать код, подменять ошибку fallback-режимом или продолжать при
  неподтверждённом Repository scope.
- Любое невыполненное обязательное условие означает BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ;
  не угадывай значение и не расширяй scope.

Это единый project entrypoint Apply. Он проверяет только OpenSpec Planning и текущий
Repository; Plugin-specific поведение остаётся вне этого skill.

## Общий preflight

1. Вызвать MCP `get_change_context` с `change_id` и `artifact: apply`, затем
   `get_assignment_scope`. Использовать возвращённые rules, paths, Tasks, Repository
   и revision; не собирать этот контекст вручную.
2. Проверить, что Repository Impact использует строгую таблицу
   `Repository | Capabilities`, все repository-id зарегистрированы, а capability paths
   имеют Delta Specs текущего Change.
3. Сравнить Repository Impact с repository sections Tasks. Для каждой repository
   section должен существовать принятый Repository Impact и наоборот.
4. Для явно принятого `skip_specs` без Delta Specs проверить Repository Impact и Tasks
   напрямую; не создавать фиктивную Delta Spec.
5. Неизвестный Repository/capability или расхождение принятого implementation scope
   блокирует Apply и не создаёт Repository автоматически.
6. Сверить полученный assignment с принятым Repository Impact. Если Graph недоступен
   и `assigned` равен `null`, прочитать Proposal через MCP resource и подтвердить
   текущий repository-id по строгой таблице Repository Impact. Не продолжать при
   расхождении или отсутствии подтверждённого scope.

Для Code Repository передать встроенному Apply только Tasks его принятой repository
section. Для Store-level координации передать исходный набор Tasks без фильтрации.

## Навигация и evidence

До кода проверить Git root и пользовательский worktree. Repository-id и полный HEAD
брать из `get_assignment_scope`. Не очищать чужие изменения.

CodeGraph разрешён только внутри current repository и только при ready index на той же
revision. Иначе использовать адресный read/search. Не запускать sync автоматически и не
считать навигационный индекс evidence реализации.

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
