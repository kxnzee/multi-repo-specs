---
name: openspec-base-meta-planning
description: Единая read-only проверка Proposal, Specs, Design, Tasks, impact или полного Planning OpenSpec Change. Использует фактические artifact rules, Graph queries и адресные вызовы repository evidence scout по правилу «один вопрос — один subagent»; не изменяет артефакты и не принимает Gate.
---

# Meta Planning

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
- Не изменять schema, встроенные OpenSpec skills/commands и Cycle.
- Не считать результат approval, Gate или evidence реализации.
- Не вызывать этот meta-skill рекурсивно.
- Не запускать все проверки формально: использовать минимальный scope текущей стадии.

Proposal и Specs являются Store-only стадиями. Code Repository, CodeGraph и
repository evidence scout для них запрещены. На Design, Tasks, impact-review и
planning-review разрешены только адресные repository evidence requests: сначала через
scout, а при его недоступности — тем же адресным read/search основного агента. Каждый
request проверяет один вопрос в одном Repository.

## Preflight

1. Выполнить openspec status --change <change-id> --json. Использовать возвращённые
   planningHome, changeRoot, artifactPaths и actionContext.
2. Для отдельного артефакта выполнить openspec instructions <artifact-id> --change
   <change-id> --json. Поле rules из этого ответа — единственный содержательный
   checklist стадии.
3. Прочитать только существующие outputs, их зависимости и релевантный Store context.
   Отсутствие ещё не разблокированного следующего артефакта не является finding.
4. Если существует openspec-orch.yaml, использовать code repository records как
   точные identity, но не как доказательство impact.

## Graph phase

До валидных Delta Specs использовать phase preliminary:

- capability candidates брать из Proposal;
- неизвестный path находить через openspec list --specs --json и читать только точную
  Master Spec;
- не выполнять Graph recovery/build и не вызывать inspect, impact или check-scope;
- stale/unavailable Graph не является blocker этой фазы;
- не объявлять Cycle scope.

После валидных Delta Specs использовать phase authoritative:

- перед первой graph query выполнить status → recovery → status по корневым
  инструкциям; derived build не нарушает read-only границу Planning, потому что не
  меняет tracked product artifacts;
- вызвать graph impact <change-id>;
- при заявленном implementation scope вызвать graph check-scope с отдельным --repo
  для каждого точного repository-id;
- missing_required_repositories, missing_delta_specs и unmapped_master_specs являются
  blockers;
- review-only Repository не входит в Repository Impact, Design map, Tasks или Cycle;
  не требовать для него no-change row или отдельный artifact;
- если проверка review Repository подтвердила необходимое изменение, вернуть Change
  в Planning и только тогда добавить его в impact и scope;
- included_review_repositories и extra_repositories являются blockers: объяснение без
  обновления принятого Planning не делает их implementation scope;
- не добавлять review repository в Cycle автоматически.

## Проверка

Сопоставить текущий артефакт с фактическими rules из openspec instructions и
подтверждёнными зависимостями:

- утверждение о целевом поведении проверяется по intent, Proposal и Specs;
- на стадии specs каждый подтверждённый сценарий, access/error/degraded/data/security
  constraint и публичное взаимодействие Intake либо покрыты Requirement/Scenario,
  либо явно сохранены в ненормативной границе без молчаливой потери;
- техническое решение трассируется к Requirement, Scenario или ограничению Proposal;
- Task трассируется к принятому поведению/решению и плану evidence;
- repository scope сопоставляется с authoritative Graph;
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

## Repository evidence

Если на разрешённой стадии нужен current-state факт, вызвать только
openspec-base-repository-evidence-scout.

- Один вопрос — один новый subagent. После декомпозиции N вопросов означают
  ровно N независимых вызовов: пять вопросов — пять subagents. Не передавать список
  вопросов и не переиспользовать завершённый или продолжающийся контекст.
- Общий или межрепозиторный вопрос сначала разложить на независимые
  repository-specific вопросы. Для каждого подготовить собственные question_id,
  полный входной контракт и отдельный результат.
- Передать question_id, question, один repository-id, проверенный checkout, полный
  revision и anchors. Identity, revision и чистоту worktree проверить до вызова.
- Для каждого вызова принять только один YAML-объект `repository_evidence` с тем же
  question_id и полями status, answer и evidence. Текст до или после YAML
  считать нарушением контракта и не использовать как evidence.

Не просить scout делать межрепозиторный вывод или собирать общий обзор. Если scout
недоступен, выполнить такой же адресный read/search самостоятельно с теми же
ограничениями. Store-level context и Planning review основной агент читает сам.

openspec-base-test-cases применять только по запросу пользователя либо для проверки
неоднозначного test coverage. Expected result брать из Planning; repository evidence
может определить только automation placement. При его отсутствии использовать
automation_placement: unknown.

## Findings

- BLOCKER — противоречие intent, Requirement, публичному контракту или обязательному
  rule либо нерешённое решение владельца.
- WARNING — риск или недостаток evidence требует явного принятия.
- NOTE — улучшение, не блокирующее следующий Planning step.

Вернуть на русском:

~~~yaml
meta_planning:
  change: <change-id>
  stage: proposal | specs | design | tasks | impact-review | planning-review
  graph_phase: preliminary | authoritative
  graph_status: ready | stale | unavailable | invalid | not_configured
  scope_check: not_applicable | ready | invalid
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
