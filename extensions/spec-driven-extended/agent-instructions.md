# Инструкции для агента

## Источники истины

- Текущий репозиторий — центральный OpenSpec Store. Requirements, Changes и
  подтверждённый долговечный context принадлежат `openspec/`; Code Repositories
  реализуют принятые Changes и владеют локальными implementation details и evidence.
- `openspec-orch.yaml` — реестр Project. Текущее состояние, artifact rules, следующий
  actor, Repository scope и revision получай через Orchestrator MCP, а нормативные
  Store artifacts — через его resources. Не восстанавливай их из пересказа.
- `openspec/context/` не заменяет Requirements и изменяется только через
  `/spec-driven-extended-context`.

## Границы

- Не открывай Code Repository или CodeGraph для Intent, Intake, Proposal,
  Requirements и Scenarios. На Design, Tasks, Apply и при проверке current-state
  conflict исследуй только один заранее сформулированный вопрос в scope, который
  вернул `get_assignment_scope`.
- Не переноси в Store внутренние paths, symbols, модули, библиотеки, локальную
  конфигурацию, build/test commands, code inventory или `path:line`. Код подтверждает
  только constraint, conflict, implementation gap или unknown.
- В Store допустимы наблюдаемое поведение, доменные правила, точные repository-id,
  принятые системные решения и публичные контракты.
- Неподтверждённый scope, revision или обязательное правило означает blocker. Не ищи
  другой checkout и не расширяй scope самостоятельно.

## Маршрутизация

- Для любого действия над существующим Change сначала получи его `schemaName` через
  `get_change_context`. Применяй маршруты, skills и команды `spec-driven-extended-*` только
  к `spec-driven-extended`. Для `superspec-multirepo` следуй artifact DAG и instructions этой
  schema; не добавляй в него spec-driven-extended Intake, meta-planning или Apply preflight.
- Для нового `spec-driven-extended` Change без принятого Intent начни с
  `spec-driven-extended-intent`; готовый полный
  Intent повторно не собирай. Первый artifact создаёт
  `/spec-driven-extended-intake <change-id>`. После Intake следующий маршрут выбирает
  пользователь. Это правило не изменяет Superspec Brainstorm.
- Для проверки Planning используй `spec-driven-extended-meta-planning`, для Apply preflight —
  `spec-driven-extended-apply-context`, для test cases — `spec-driven-extended-test-cases`, для
  долговечного context и ADR — `/spec-driven-extended-context`.
- Если маршрут не очевиден, вызови `get_next_action` и соблюдай возвращённого actor.
  Точные содержательные правила бери из `get_change_context`, а не из памяти.

## Подтверждения из Repository

- Единственный project subagent — `spec-driven-extended-repository-evidence-scout`. Используй
  его только на разрешённой стадии и по его собственному входному/выходному контракту.
- Один вопрос — один новый subagent: пять вопросов — пять subagents. Scope и revision
  для каждого вызова возьми из `get_assignment_scope`.
- Основной агент сам читает Store context, выполняет Planning review и проверяет
  evidence. Отдельные context/planning subagents не используются.

## Постоянные ограничения

- Не создавай openspec/changes/ в Code Repositories.
- Не изменяй встроенные openspec-* skills и opsx-* commands.
- Результат skill, MCP или subagent не является человеческим Gate.
- Не выполняй commit, push, merge, release или Archive без явного пользовательского
  действия или принятого командного процесса.
- Не архивируй Change до завершения реализации затронутых repositories и ручной
  проверки. До и после Archive выполни guidance из openspec/config.yaml.
