---
name: spec-driven-extended-apply-context
description: "[spec-driven-extended] Проверить repository scope перед штатным OpenSpec Apply."
argument-hint: "[change-id]"
---

# Контекст Apply

- ОБЯЗАН выполнить общий preflight до передачи управления встроенному Apply.
- ЗАПРЕЩЕНО писать код, подменять ошибку fallback-режимом или продолжать при
  неподтверждённом Repository scope.
- Любое невыполненное обязательное условие означает BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ;
  не угадывай значение и не расширяй scope.

При вызове из штатного Apply верни preflight вызывающему workflow и не запускай
Apply повторно: его schema instruction уже привела сюда. При прямом запуске
вызови установленный штатный OpenSpec Apply через механизм skills/commands Agent
один раз, передав Change и проверенный scope. Текстовое обещание продолжить, MCP
Apply Context и tracking не заменяют этот вызов. До передачи управления не пиши
код, не отмечай Tasks и не начинай implementation attempt.

Это preflight helper, а не точка входа в реализацию. Единственная точка входа —
штатный OpenSpec Apply. Helper проверяет только OpenSpec Planning и текущий
Repository; Plugin-specific поведение остаётся вне этого skill.

## Общая предварительная проверка

0. Определить точный Change из запроса или Work Context. Сначала проверить
   `openspec_status.schemaName` в актуальном `get_change_context` без `artifact`.
   Для другой schema вернуть `BLOCKER: SCHEMA_MISMATCH`; не запускать этот
   preflight или встроенный Apply.
1. Переиспользовать актуальный Work Context для того же `change_id` и `artifact: apply`.
   Если его нет или наступила граница свежести, один раз вызвать MCP
   `get_change_context` с `change_id`, `artifact: apply` и `include_assignment: true`.
   Instructions и Tasks брать из `artifact_instructions`, paths — из
   `openspec_status`, repository scope — из вложенного `assignment_scope`; не
   вызывай `get_assignment_scope` повторно, когда эти Repository и checkout уже
   получены, и не собирай этот контекст вручную.
2. Проверить, что Repository Impact использует строгую таблицу
   `Repository | Capabilities`, все repository-id зарегистрированы, а capability paths
   имеют Delta Specs текущего Change.
3. Сравнить Repository Impact с repository sections Tasks. Для каждой repository
   section должен существовать принятый Repository Impact и наоборот.
4. Для явно принятого `skip_specs` без Delta Specs проверить Repository Impact и Tasks
   напрямую; не создавать фиктивную Delta Spec.
5. Неизвестный Repository/capability или расхождение принятого implementation scope
   блокирует Apply и не создаёт Repository автоматически.
6. Сверить полученный assignment с принятым Repository Impact. Если
   `assignment_scope.assigned` равен `null`, прочитать Proposal через MCP resource
   и подтвердить
   текущий repository-id по строгой таблице Repository Impact. Не продолжать при
   расхождении или отсутствии подтверждённого scope.

Для `current_assignment.role: code` найти запись с тем же repository-id в
`assignment_scope.assignments`, требовать `connected: true` и совпадение её
`checkout` с `current_assignment.path`. `assigned: false` блокирует реализацию; `null`
требует прямого подтверждения через Proposal, как описано выше. Store с
`current_assignment.role: store` выполняет только координацию и не считается
назначенным Code Repository. Неизвестная роль или отсутствующий assignment — blocker.

Для Code Repository передать встроенному Apply только Tasks его принятой repository
section. Для Store-level координации передать исходный набор Tasks без фильтрации.
## Навигация и подтверждения

До кода подтвердить доступность назначенного checkout. Repository-id и checkout
брать из вложенного `assignment_scope`; отдельный `get_assignment_scope` допустим только
при отсутствии этих данных или после границы свежести. Не очищать чужие изменения.

Исследование кода разрешено только внутри подтверждённого current repository.
Соблюдай применимые правила навигации из активных инструкций проекта, включая
обязательный первый инструмент и допустимый fallback. Не расширяй scope и не
изменяй состояние инструментов автоматически. Навигация не доказывает реализацию.

## Результат

Верни вызывающему Apply проверенный scope:

~~~yaml
apply_scope:
  change: <change-id>
  repository: <repository-id|null>
  repository_impact: direct | review | extra | not_applicable
  code_navigation: <применённый способ исследования или not_applicable>
  selected_tasks: []
  scope_status: ready | blocked
~~~
