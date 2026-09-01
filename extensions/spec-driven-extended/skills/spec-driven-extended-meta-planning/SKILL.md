---
name: spec-driven-extended-meta-planning
description: Единая read-only проверка Proposal, Specs, Design, Tasks, impact или полного Planning OpenSpec Change. Использует фактические artifact rules, Store-артефакты и адресные вызовы repository evidence scout по правилу «один вопрос — один subagent»; не изменяет артефакты и не принимает Gate.
---

# Проверка Planning

- ОБЯЗАН проверять только фактические rules текущей стадии и подтверждённые sources.
- ЗАПРЕЩЕНО компенсировать отсутствие evidence догадкой, чтением запрещённого Code
  Repository, расширением scope или созданием параллельного workflow.
- Нарушение artifact boundary, нерешённое решение владельца или обязательный rule без
  evidence означает BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ и не возвращай ready.

Проверить одну стадию: proposal, specs, design, tasks, impact-review или
planning-review. Не создавать параллельный workflow и не повторять содержательные
правила артефактов из openspec/config.yaml.

## Границы

- Не изменять Change, Master Specs, код, тесты или Tasks.
- Не изменять schema, встроенные OpenSpec skills/commands или состояние выполнения.
- Не считать результат approval, Gate или evidence реализации.
- Не вызывать этот meta-skill рекурсивно.
- Не запускать все проверки формально: использовать минимальный scope текущей стадии.

Proposal и Specs являются Store-only стадиями. Code Repository, CodeGraph и
repository evidence scout для них запрещены. На Design, Tasks, impact-review и
planning-review разрешены только адресные repository evidence requests: сначала через
scout, а при его недоступности — тем же адресным read/search основного агента. Каждый
request проверяет один вопрос в одном Repository.

## Предварительная проверка

1. Вызвать MCP `get_change_context` с `change_id` и текущим `artifact`. Использовать
   возвращённые planningHome, changeRoot, artifactPaths, actionContext и rules.
2. `rules` из этого ответа — единственный содержательный checklist стадии. Не
   реконструировать его из документации или памяти сессии.
3. Прочитать только существующие outputs, их зависимости и релевантный Store context.
   Отсутствие ещё не разблокированного следующего артефакта не является finding.
4. Если существует openspec-orch.yaml, использовать code repository records как
   точные identity, но не как доказательство impact.

## Область capability и Repository

До валидных Delta Specs:

- capability candidates брать из Proposal;
- неизвестный path находить через openspec list --specs --json и читать только точную
  Master Spec;
- не объявлять repository implementation scope до принятого Repository Impact.

После валидных Delta Specs:

- сверить таблицу Repository Impact с capabilities Delta Specs, Design map и Tasks;
- проверить repository-id по registry из `openspec-orch.yaml`, а capability paths —
  по Delta Specs текущего Change;
- не принимать свободный список Repository как mapping и не допускать неявный
  cross-product между несколькими repositories и capabilities;
- review-only Repository не входит в Repository Impact, Design map или Tasks;
  если проверка подтвердила необходимое изменение, вернуть Change в Planning и только
  тогда добавить точную строку mapping;
- неизвестный Repository или capability является blocker и не расширяет scope
  автоматически.

## Проверка

Сопоставить текущий артефакт с фактическими rules из `get_change_context` и
подтверждёнными зависимостями:

- утверждение о целевом поведении проверяется по intent, Proposal и Specs;
- на стадии specs каждый подтверждённый сценарий, access/error/degraded/data/security
  constraint и публичное взаимодействие Intake либо покрыты Requirement/Scenario,
  либо явно сохранены в ненормативной границе без молчаливой потери;
- техническое решение трассируется к Requirement, Scenario или ограничению Proposal;
- Task трассируется к принятому поведению/решению и плану evidence;
- repository scope сопоставляется с Repository Impact, Delta Specs, Design map и Tasks;
- Repository Impact содержит только repositories с планируемыми изменениями и не
  повторяет весь registry либо review-контур;
- полный Planning Review проверяет цепочку source → Why/scope → capability →
  Requirement → Scenario → Design decision → Task → evidence.

Расхождение целевого Requirement с текущим кодом — implementation gap, а не причина
переписать Requirement. Код может опровергнуть только утверждение о текущем состоянии
или технической возможности.

Repository finding с path:line остаётся в результате проверки и не переносится в
Change или долговечный Store context. Если Proposal, Specs, Design или Tasks содержат
внутренние paths, symbols, code inventory, локальную конфигурацию, команды сборки,
таблицы или выбранные библиотеки Code Repository, meta-review ОБЯЗАН вернуть BLOCKER и потребовать
переписать их через наблюдаемое поведение, публичный контракт, системное решение,
repository-id и проверяемый результат. Публичный нормативный контракт не считается
внутренней деталью реализации.

Для impact-review проверять только применимые contracts, data, security,
compatibility, migration, rollout, rollback и verification. Для каждого вывода дать
Requirement/Scenario или path:line и отделить факт, вывод, конфликт и unknown.

## Подтверждения из Repository

Если на разрешённой стадии нужен current-state факт, вызвать только
spec-driven-extended-repository-evidence-scout.

- Один вопрос — один новый subagent. После декомпозиции N вопросов означают
  ровно N независимых вызовов: пять вопросов — пять subagents. Не передавать список
  вопросов и не переиспользовать завершённый или продолжающийся контекст.
- Общий или межрепозиторный вопрос сначала разложить на независимые
  repository-specific вопросы. Для каждого подготовить собственные question_id,
  полный входной контракт и отдельный результат.
- Передать question_id, question, один repository-id, checkout, revision и anchors
  из `get_assignment_scope`. Чистоту worktree проверить до вызова.
- Для каждого вызова принять только один YAML-объект `repository_evidence` с тем же
  question_id и полями status, answer и evidence. Текст до или после YAML
  считать нарушением контракта и не использовать как evidence.

Не просить scout делать межрепозиторный вывод или собирать общий обзор. Если scout
недоступен, выполнить такой же адресный read/search самостоятельно с теми же
ограничениями. Store-level context и Planning review основной агент читает сам.

spec-driven-extended-test-cases применять только по запросу пользователя либо для проверки
неоднозначного test coverage. Expected result брать из Planning; repository evidence
может определить только automation placement. При его отсутствии использовать
automation_placement: unknown.

## Результаты проверки

- BLOCKER — противоречие intent, Requirement, публичному контракту или обязательному
  rule либо нерешённое решение владельца.
- WARNING — риск или недостаток evidence требует явного принятия.
- NOTE — улучшение, не блокирующее следующий Planning step.

Вернуть на русском:

~~~yaml
meta_planning:
  change: <change-id>
  stage: proposal | specs | design | tasks | impact-review | planning-review
  artifact_check: ready | invalid
  scope_status: not_applicable | ready | invalid
  checks_used: []
  repository_scout_used: false
  findings: { blockers: 0, warnings: 0, notes: 0 }
  check_status: ready | needs_revision | blocked
  next_action: continue | revise_current_artifact | request_owner_decision
~~~

После блока вывести только findings текущей стадии с evidence и требуемым решением.
Для impact-review добавить impact/repository matrix, для planning-review —
traceability/repository coverage matrix. ready не является approval или
подтверждением реализации.
