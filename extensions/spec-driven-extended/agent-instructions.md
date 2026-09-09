# Работа с spec-driven-extended

Этот Extension помогает вести контекст проекта и workflow `spec-driven-extended`
в центральном OpenSpec Store. Основной агент ведёт диалог с пользователем,
работает с артефактами и проверяет evidence. OpenSpec определяет порядок стадий
и требования к их результатам.

## Получи контекст задачи

Для работы с существующим Change используй актуальный Work Context из Orchestrator
MCP. Переиспользуй его по `context_revision` согласно gateway policy; после границы
свежести обнови через `get_change_context`. Точные содержательные правила бери из `get_change_context`.

Ответ содержит:

- `openspec_status`: выбранную `schemaName` и пути `planningHome`, `changeRoot`,
  `artifactPaths`, `actionContext`;
- `artifact_instructions`: `instruction`, `rules` и `template` запрошенного artifact.
  Без аргумента `artifact` поле равно `null`; пустые дополнительные `rules`
  не отменяют требования `instruction`;
- `assignment_scope`: Repository scope и revision при `include_assignment: true`.

`openspec-orch.yaml` задаёт реестр Project. Нормативные Store artifacts читай через
MCP resources. Если следующий шаг неясен, вызови `get_next_action` и учитывай
возвращённого actor.

## Выбери рабочий маршрут

Сначала проверь `schemaName`. Workflow-маршруты этого Extension применяются только
к `spec-driven-extended`. Для другой schema следуй её artifact DAG и instructions;
не добавляй стадии или preflight этого Extension.

| Задача | Средство Extension |
| --- | --- |
| Собрать или обновить долговечный context и ADR | Команда `/spec-driven-extended-context` |
| Сформулировать Intent нового Change | Skill `spec-driven-extended-intent` |
| Создать Intake из принятого Intent | Команда `/spec-driven-extended-intake <change-id>` |
| Проверить Planning | Skill `spec-driven-extended-meta-planning` |
| Подготовить Repository scope для штатного Apply | Skill `spec-driven-extended-apply-context` |
| Подготовить test cases | Skill `spec-driven-extended-test-cases` |

Команды вызываются внутри Agent. Здесь приведены имена Qwen/GigaCode;
в Claude Plugin добавляет namespace `spec-driven-extended:`, например
`/spec-driven-extended:spec-driven-extended-context`. Skills подключаются через
механизм skills Agent и выполняются по своему `SKILL.md`.

Штатные действия OpenSpec вызываются через `/opsx-<действие>` в Qwen/GigaCode
и `/opsx:<действие>` в Claude. Рекомендуя действие, используй фактически
установленную команду выбранного провайдера.

При запросе на реализацию существующего Change сначала вызови установленный
штатный OpenSpec Apply через механизм skills/commands Agent (`/opsx:apply` или
`/opsx-apply`). Получение MCP Apply Context и tracking не заменяют этот вызов.
Внутри `spec-driven-extended` Apply до изменения кода вызови skill
`spec-driven-extended-apply-context` и получи `apply_scope.scope_status: ready`
для текущего Change и Repository. Это preflight helper, а не самостоятельный
workflow реализации. При прямом вызове helper должен передать управление штатному
Apply через механизм Agent; когда он вызван из Apply, вернуться без повторного
запуска Apply. Если skill недоступен или preflight заблокирован, остановись до кода.

Для нового Change начни с Intent, если он ещё не принят. Готовый полный Intent
используй без повторного сбора. Первый artifact создаёт команда Intake;
после неё следующий маршрут выбирает пользователь.

Команда context работает независимо от schema и не требует Change. Её аргумент
`--change` задаёт источник и scope проверки, а не запускает workflow.
`openspec/context/` обновляй через эту команду; требования Change остаются
в его нормативных артефактах.

## Разделяй контекст Store и реализацию

Store хранит Requirements, Changes и подтверждённый долговечный context в
`openspec/`. Его содержание — наблюдаемое поведение, доменные правила, точные
repository-id, принятые системные решения и публичные контракты.

Code Repositories реализуют принятые Changes и хранят детали реализации и локальные
evidence: внутренние paths, symbols, модули, библиотеки, конфигурацию, build/test
commands, code inventory и ссылки `path:line`. Эти детали остаются в Repository;
в Store переносится только подтверждённый constraint, conflict, implementation gap
или unknown.

Для Intent, Intake, Proposal, Requirements и Scenarios работай с источниками Store
без исследования Code Repository. На Design, Tasks, Apply и при проверке
current-state conflict допускается адресное исследование кода: один заранее
сформулированный вопрос в подтверждённом `assignment_scope`.

Эти границы относятся к workflow `spec-driven-extended` и долговечному context.
Содержание и пути артефактов других schemas задают их актуальные instructions.

## Получай подтверждения из Repository

Для адресного исследования используй единственный project subagent
`spec-driven-extended-repository-evidence-scout`. Его собственная инструкция
определяет обязательный вход, способ исследования и формат ответа.
Перед первым вызовом прочитай [полный профиль scout](subagents/spec-driven-extended-repository-evidence-scout.md)
из этого установленного Extension.
Собери запрос по его входному контракту; краткое описание subagent не заменяет
этот контракт. Передай в `code_navigation` применимые инструкции навигации из
активного контекста проекта полностью: первый шаг, параметры инструментов,
ограничения и fallback. Не рассчитывай, что subagent унаследует контекст родителя.
Перед использованием ответа сверь его структуру и question_id
с профилем и отправленным запросом. Невалидный ответ оставляет вопрос открытым.

Один вопрос — один новый subagent: пять вопросов — пять subagents. Scope и revision
бери из актуального `assignment_scope`; отдельно вызывай `get_assignment_scope`,
когда этих данных нет или наступила граница свежести. Основной агент сам читает
Store context, выполняет Planning review и проверяет полученные evidence;
отдельные context/planning subagents не используются.

Если scope, revision или обязательное правило не подтверждены, зафиксируй blocker
и укажи, чего не хватает для продолжения. Сохраняй назначенный checkout и scope.

## Завершай работу в рамках процесса команды

Changes создаются только в Store. Встроенные `openspec-*` skills и `opsx-*` commands
остаются под управлением OpenSpec и не редактируются этим workflow.

Результат skill, MCP или subagent не заменяет человеческий Gate. Для commit, push,
merge, release и Archive требуется явное пользовательское действие или принятый
командный процесс. Archive выполняется после реализации затронутых repositories
и ручной проверки; до и после него выполни guidance из `openspec/config.yaml`.
