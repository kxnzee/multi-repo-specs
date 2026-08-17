---
name: openspec-base-planning-check
description: Проверить текущий этап планирования OpenSpec Change и выбрать минимальный набор project skills и read-only subagents для Proposal, Specs, Design, Tasks или полного Planning. Использовать, когда artifact rules требуют промежуточную проверку, перед переходом к следующему артефакту либо когда нужно понять, какую проверку запустить. Не изменять артефакты и не принимать Gate.
---

# Проверка этапа Planning

Маршрутизировать проверку текущего артефакта, не создавая отдельный workflow или
review-файл.

## Границы

- Работать только на чтение. Не изменять Change, Master Specs, код, тесты или Tasks.
- Не изменять schema и встроенные `openspec-*` skills или `opsx-*` commands.
- Не считать результат approval, Gate, Verification Receipt или доказательством
  реализации.
- Не запускать все проверки по умолчанию: выбирать минимальный набор по стадии и
  рискам.
- Не вызывать `openspec-base-planning-check` рекурсивно.

## Определение контекста

1. Определить Change и выполнить `openspec status --change "<change-id>" --json` с
   выбранным `--store`, если он используется.
2. Использовать `planningHome`, `changeRoot`, `artifactPaths` и `actionContext` из
   ответа. Прочитать существующие outputs и относящийся project context.
3. Определить стадию из явного запроса или текущего артефакта:
   `proposal`, `specs`, `design`, `tasks`, `planning-review`. Если выбор неоднозначен,
   остановиться и запросить одну стадию.
4. Для artifact-стадии получить `openspec instructions <artifact-id> --change
   "<change-id>" --json` и проверить её `instruction`, `rules`, зависимости и
   `resolvedOutputPath`. Отсутствие ещё не разблокированных последующих артефактов не
   считать finding.

## Маршрутизация

### Proposal

- Применить workflow project skill `openspec-base-analyze-impact` к текущему Change.
- Использовать `openspec-base-project-context-researcher`, если спорны intent,
  текущее наблюдаемое поведение или доменные правила.
- Использовать `openspec-base-implementation-scout` с одним `repository-id`, если
  категория Repository impact зависит от существующего кода или тестов.
- Использовать `openspec-base-architecture-impact-reviewer` только при реальной
  неопределённости межсистемного контракта, security, совместимости, миграции,
  rollout или rollback.
- Проверить Jira/источник, Why, scope, capabilities, явные исключения и обоснование
  каждого `implementation | tests-only | configuration | documentation | no-change`.

### Specs

- Проверить соответствие capability из Proposal, наблюдаемость Requirements,
  однозначность Scenarios и стабильные Scenario ID.
- Передать `openspec-base-specification-reviewer` режим `artifact-review`, текущие
  Specs и их завершённые зависимости. Missing Design и Tasks в этом режиме не
  являются finding.
- Привлекать project-context researcher только для одного спорного поведения; не
  переносить техническую декомпозицию репозиториев в Requirements и Scenarios.

### Design

- Применить `openspec-base-analyze-impact`, если Repository impact или границы систем
  изменились после Proposal.
- Использовать `openspec-base-architecture-impact-reviewer` для одного ограниченного
  вопроса о контракте, совместимости, security, миграции, rollout или rollback.
- Использовать implementation scout только для подтверждения конкретной точки входа
  в одном `repository-id`.
- Проверить согласованность Repository implementation map с Proposal и Specs.

### Tasks

- Передать specification reviewer режим `artifact-review` для проверки цепочки
  `Scenario → Design decision → Task` по уже существующим артефактам.
- Использовать `openspec-base-verification-reviewer`, если неясны evidence, уровень
  проверки или покрытие нескольких репозиториев.
- Применять `openspec-base-test-cases` только когда пользователь просит тест-кейсы
  либо проверка выявила неоднозначное тестовое покрытие; не создавать нештатный файл
  автоматически.

### Полный Planning

- Применить `openspec-base-review-change` в режиме `planning-review`.
- Выполнить штатную строгую неинтерактивную валидацию Change.
- Не подменять человеческий Gate результатом skill или subagent.

## Выбор subagents

- Перед применением выбранного project skill полностью прочитать его `SKILL.md` и
  следовать его контракту; не восстанавливать поведение skill только по имени.
- Передавать каждому subagent один вопрос, точный Change, стадию и минимальный scope.
- Для repository-specific вопроса передавать ровно один `repository-id`; независимые
  вопросы по разным репозиториям можно выполнять параллельно.
- Не сообщать subagent предполагаемый ответ. Передавать исходный артефакт и вопрос,
  чтобы получить независимое evidence.
- Если нужный subagent недоступен, выполнить адресное read/search самостоятельно и
  явно назвать fallback. Отсутствие subagent само по себе не блокирует проверку.

## Решение

Удалить дубликаты findings и классифицировать их:

- `BLOCKER` — артефакт противоречит подтверждённому intent, коду, контракту или
  обязательному правилу, либо требует решения владельца до продолжения;
- `WARNING` — риск или недостаток evidence должен быть явно принят;
- `NOTE` — улучшение, не мешающее следующему шагу.

Вернуть на русском:

```yaml
planning_check:
  change: <change-id>
  stage: <stage>
  checks_used: []
  subagents_used: []
  findings:
    blockers: 0
    warnings: 0
    notes: 0
  check_status: ready | needs_revision | blocked
  next_action: continue | revise_current_artifact | request_owner_decision
```

После блока привести findings с evidence `path:line` или Requirement/Scenario и
требуемым решением. `ready` означает только отсутствие найденных препятствий для
следующего Planning-шага в прочитанном scope.
