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
передай проверенный scope в штатный Apply один раз.

Это единый project entrypoint Apply. Он проверяет только OpenSpec Planning и текущий
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
   вызывай `get_assignment_scope` повторно, когда эти Repository и revision уже
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

Для `current_assignment.role: code` требовать connected checkout и совпадение
его полного HEAD с assignment. `assigned: false` блокирует реализацию; `null`
требует прямого подтверждения через Proposal, как описано выше. Store с
`current_assignment.role: store` выполняет только координацию и не считается
назначенным Code Repository. Неизвестная роль или отсутствующий assignment — blocker.

Для Code Repository передать встроенному Apply только Tasks его принятой repository
section. Для Store-level координации передать исходный набор Tasks без фильтрации.
## Навигация и подтверждения

До кода проверить Git root и пользовательский worktree. Repository-id и полный HEAD
брать из вложенного `assignment_scope`; отдельный `get_assignment_scope` допустим только
при отсутствии этих данных или после границы свежести. Не очищать чужие изменения.

CodeGraph разрешён только внутри подтверждённого current repository. Если индекс
есть, а MCP недоступен, остановиться согласно CodeGraph Extension. Адресный
read/search допустим при отсутствии индекса либо когда сам MCP сообщил stale или
unavailable. Индекс другой revision не подтверждает текущий код. Не запускать
sync автоматически и не считать навигационный индекс evidence реализации.

Перед checkbox сформировать:

Для task_id используй точный `id` выбранной задачи из
`artifact_instructions.tasks` актуального Apply-контекста. Номер `1.1` или `2.3`
в начале description служит подписью в документе и может отличаться от ID OpenSpec.
Сопоставляй полное описание и repository section; не вычисляй индекс самостоятельно.

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
- coverage сопоставлено с принятым контрактом независимо от списка написанных
  тестов: проверены допустимые значения, default/отсутствие и значимые классы
  недопустимых входов. «Любое другое значение» требует проверки типов, а не только
  одного неизвестного литерала; для lookup/coercion проверь унаследованные имена,
  массивы и объекты с преобразованием, если они входят в домен входов контракта;
- межрепозиторная проверка покрывает согласованные варианты публичного обмена,
  включая default, а утверждения «без преобразования»/«не выбрасывает» подтверждены
  поведением на соответствующих входах. Зелёные тесты сами по себе не доказывают
  полноту; отсутствующий accepted contract не дополняется выдуманным требованием;
- план проверки или рассуждение не выдаются за выполненную verification.

После `satisfied` передай результат вызывающему Apply: запись progress выполняется
по актуальной schema instruction. Сам preflight не отмечает задачи и не выполняет
реализацию. Blocked Task остаётся незакрытой; принятые описания задач не меняются.
Если результаты реализации требуют изменить смысл Intake или другого раннего артефакта,
приостановить затронутую работу и вернуть finding в Planning. Planning актуализирует
затронутые артефакты по правилу сверки из project context, повторяет проверки и
необходимые согласования. Перед возобновлением Apply заново выполнить preflight.
Редакционная правка без изменения смысла сама по себе не требует остановки Apply
или повторных Gate 1 и Feature Acceptance; передать её на review и сверку.
Повторная Feature Acceptance нужна при изменении реализации, проверяемого
контракта или потере применимости прежнего evidence.

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
