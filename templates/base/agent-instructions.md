# Инструкции для агента

## Источники истины

- Текущий репозиторий — центральный OpenSpec Store. Requirements и Changes
  принадлежат каталогу openspec/; Code Repositories только реализуют принятые Changes.
- openspec/context/ содержит подтверждённый долговечный контекст, но не заменяет
  Requirements. Его обновляет только команда /openspec-base-context.
- openspec-orch.yaml — реестр точных repository-id. openspec/graph.yaml содержит
  только explicit relations; типизированную модель читать через OpenSpec Graph Plugin.
- Локальное устройство, test/build commands и implementation evidence принадлежат
  конкретному Code Repository и не копируются в Store context.

## КРИТИЧЕСКИЕ ЗАПРЕТЫ

ЭТИ ПРАВИЛА ОБЯЗАТЕЛЬНЫ. Полнота ответа, удобство и желание «добавить контекст» не
являются оправданием для нарушения.

1. НЕ ОТКРЫВАЙ Code Repository или CodeGraph при создании Intent, Proposal,
   Requirements и Scenarios. Их источники — запрос и решения владельца, Master Specs
   и подтверждённый Store context.
2. На Design, Tasks и Apply открывай Code Repository ТОЛЬКО для подтверждения или
   опровержения одного заранее сформулированного current-state утверждения, проверки
   совместимости либо реализуемости принятого решения.
3. ЗАПРЕЩЕНО переносить в Store paths, symbols, модули, таблицы, библиотеки, локальную
   конфигурацию, build/test commands, code inventory и path:line. Код может подтвердить
   только constraint, conflict, implementation gap или unknown.
4. В Store разрешены только наблюдаемое поведение, доменные правила, repository-id,
   принятые системные решения и публичные контракты.
5. Если правило нарушено или его нельзя выполнить однозначно, НЕМЕДЛЕННО ОСТАНОВИСЬ.
   Не завершай артефакт и верни blocker с точной причиной.

## Маршрутизация

- Intent перед Planning: base-intent.
- Проверка Proposal, Specs, Design, Tasks, impact или полного Planning:
  openspec-base-meta-planning.
- Preflight standard или repository-scoped штатного Apply:
  openspec-base-apply-context.
- Аудит или точечное изменение explicit edge, а также обязательная сверка
  `implemented_by` для directly changed Master Specs перед Gate 1 и после Archive:
  openspec-base-graph-maintenance.
- Трассируемые test cases: openspec-base-test-cases.
- Инициализация, аудит и обновление Store context: /openspec-base-context.

Artifact rules Proposal/Specs/Design/Tasks находятся только в openspec/config.yaml.
Не восстанавливай их по краткому описанию skills.

Repository Impact — не инвентаризация registry. ОБЯЗАН указывать ТОЛЬКО Repository,
где Change требует изменения кода, тестов, конфигурации или документации. ЗАПРЕЩЕНО
добавлять остальные зарегистрированные, соседние, verification или review-only
repositories и создавать для них строки no-change. Graph review-кандидат входит в
Planning ТОЛЬКО после подтверждения, что в нём действительно требуется изменение.

Единственный project subagent — openspec-base-repository-evidence-scout. Он разрешён
только на Design, Tasks, Apply или при явной проверке current-state conflict из
context command. Передавай один repository-id, полный Git SHA, один claim,
why_code_needed, непустые anchors и stop_condition. Основной агент сам читает
Store-level context и выполняет Planning review; отдельные context/planning subagents
не используются.

## OpenSpec Graph lifecycle

Перед inspect, impact, check-scope или view:

1. Выполни openspec-orch graph status --json.
2. При ready и authoritative продолжай.
3. При stale или unavailable выполни точный next_command, повтори status и продолжай
   только при ready.
4. При invalid, отсутствующем binding или неготовом повторном status остановись.
   Last-known-good допустим только для диагностики.

Graph build меняет только локальный производный Plugin index и является обычной
частью pre-query workflow. После изменения Delta Spec, Master Spec, registry identity,
openspec/graph.yaml или Archive выполни build и status. Изменение только кода или
CodeGraph не требует OpenSpec Graph build.

`Delta Spec → targets → Repository` фиксирует scope только одного Change и
ЗАПРЕЩЕНО считать её заменой `Master Spec → implemented_by → Repository`. Перед Gate
1 и после Archive ОБЯЗАН проверить через openspec-base-graph-maintenance каждую
directly changed Master Spec. Если подтверждённый постоянный implementation mapping
отсутствует, Graph handoff НЕ ЗАВЕРШЁН. Не добавляй review-only, verification-only,
no-change или временно затронутый Repository.

Если capability path неизвестен, получи список через openspec list --specs --json,
выбери точный ID и только затем вызывай graph inspect. Не выбирай fuzzy candidate,
не обращай направление relation и не достраивай отсутствующую связь.

## Доступ к Code Repository

- Открывай Code Repository только для одного конкретного технического утверждения,
  которое нельзя проверить по Store, Specs, Graph и подтверждённой архитектуре.
- Путь принимай только из разрешённого runtime/workset root, явного абсолютного пути
  пользователя или openspec-orch repository status --repo <repository-id>. Не читай
  .openspec-orch/state.json напрямую.
- Канонизируй path, проверь Git root, repository identity, полный HEAD и допустимое
  состояние worktree. Не ищи workspace или checkout обходом файловой системы.
- Ограничивай чтение одним checkout. Не открывай родительские, соседние repositories
  и другой repository Cycle в том же evidence request.
- CodeGraph используй только внутри уже разрешённого Repository и только когда его
  index соответствует revision. Он ускоряет навигацию, но не доказывает runtime
  behavior или выполнение проверки.

Если path или revision не подтверждены, останови repository-specific исследование и
запроси точный путь либо предложи пользователю выполнить openspec-orch connect.

## Постоянные ограничения

- Не создавай openspec/changes/ в Code Repositories.
- Не изменяй встроенные openspec-* skills и opsx-* commands.
- openspec-base-meta-planning — единственный project meta-skill. Остальные skills и
  repository scout являются leaf-артефактами и не вызывают skills, commands или
  других agents.
- /openspec-base-context может вызвать только repository evidence scout и только по
  его полному входному контракту.
- Результат skill или subagent не является человеческим Gate.
- Не выполняй commit, push, merge, release или Archive без явного пользовательского
  действия или принятого командного процесса.
- Не архивируй Change до завершения реализации затронутых repositories и ручной
  проверки. До и после Archive выполни guidance из openspec/config.yaml.
