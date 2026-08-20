---
name: openspec-base-meta-planning
description: Единый мета-skill для проверки отдельных Planning-артефактов, анализа влияния и полного read-only ревью OpenSpec Change. Использовать для стадий proposal, specs, design, tasks, impact-review или planning-review. Маршрутизирует узкие read-only subagents, но не изменяет артефакты и не принимает Gate.
---

# Мета-проверка Planning

Быть единой точкой входа для проверки OpenSpec Planning. Не создавать отдельный
workflow или промежуточный review-файл и не вызывать другие мета-skills.

## Границы

- Работать только на чтение. Не изменять Change, Master Specs, код, тесты или Tasks.
- Не изменять schema и встроенные `openspec-*` skills или `opsx-*` commands.
- Быть единственным project meta-skill и единственным skill, который оркестрирует
  другие project skills и Planning subagents. Не передавать им право дальнейшего
  вызова skills, commands или subagents.
- Не считать результат approval, Gate, Verification Receipt или доказательством
  реализации.
- Не запускать все проверки по умолчанию: выбирать минимальный набор по стадии,
  подтверждённым рискам и запросу пользователя.
- Не выдавать отсутствие evidence за отсутствие проблемы и не считать имя файла,
  каталога или сервиса доказательством поведения.
- Не вызывать `openspec-base-meta-planning` рекурсивно.

## Режим

Использовать явно переданную стадию либо определить её из запроса и текущего
артефакта:

- `proposal` — продуктовая постановка и границы Change;
- `specs` — наблюдаемое поведение и Scenarios;
- `design` — технические решения и их связь с требованиями;
- `tasks` — план реализации и evidence;
- `impact-review` — отдельный доказательный анализ влияния после формирования
  продуктовой постановки;
- `planning-review` — сквозная проверка Proposal, Specs, Design и Tasks перед
  человеческим Gate.

Если режим неоднозначен, остановиться и запросить один режим. Не выполнять здесь
implementation readiness или PR alignment: их владельцы — соответственно
`openspec-base-apply-context` и штатный OpenSpec Verify.

## Определение контекста

1. Определить Change и выполнить `openspec status --change "<change-id>" --json` с
   выбранным `--store`, если он используется.
2. Использовать `planningHome`, `changeRoot`, `artifactPaths` и `actionContext` из
   ответа. Прочитать существующие outputs и только относящийся к вопросу project
   context.
3. Для стадии артефакта получить `openspec instructions <artifact-id> --change
   "<change-id>" --json` и проверить `instruction`, `rules`, зависимости и
   `resolvedOutputPath`. Отсутствие ещё не разблокированных последующих артефактов не
   считать finding.
4. Если существует `openspec-orch.yaml`, получить из него точные `repository-id`
   записей с `roles: [code]` и сопоставить их с `system-map.yaml`. Технический
   контекст читать только в checkout соответствующего Code Repository через контракт
   `openspec-base-repository-evidence-scout`; не смешивать evidence разных revisions.

## Общий порядок

Для Change с изменением поведения сначала проверить продуктовую постановку:

1. источник запроса и причина изменения;
2. затронутые пользователи, роли или внешние системы;
3. текущее и целевое наблюдаемое поведение;
4. доменные и бизнес-правила;
5. scope, Non-Goals и критерии успеха;
6. вопросы, требующие решения владельца.

Для чисто технического Change вместо пользовательского сценария требовать
инженерную или эксплуатационную проблему и наблюдаемый результат. Код может
подтвердить текущее поведение и ограничения, но не является источником intent или
новых требований.

Если обязательная продуктовая информация отсутствует, вернуть `needs_revision` или
`blocked` и не переходить к широкому impact-анализу. Задать владельцу один
необходимый вопрос. Только после согласованной постановки исследовать реализацию и
архитектурное влияние.

## Проверка по стадии

### Proposal

- Проверить Jira или другой источник, Why, пользователей, текущее и целевое
  поведение, доменные правила, scope, Non-Goals, критерии успеха, capabilities и
  открытые решения владельца.
- Использовать `openspec-base-project-context-researcher`, если спорны текущее
  наблюдаемое поведение или доменные правила в центральном Store. Не передавать ему
  Code Repository и не использовать context evidence вместо решения владельца.
- После готовности продуктовой постановки определить только необходимый Repository
  impact. Использовать `openspec-base-repository-evidence-scout` с
  `evidence_kind: implementation`, только если категория влияния зависит от
  существующего кода или тестов.
- При реальной неопределённости межсистемного контракта, security, совместимости,
  миграции, rollout или rollback использовать
  `openspec-base-repository-evidence-scout` с `evidence_kind: architecture` отдельно
  для каждой требующей проверки стороны. Межрепозиторный вывод собирает основной
  агент.
- Проверить, что Proposal описывает WHY и WHAT. Внутренние файлы, классы, функции,
  построчное code evidence, точки реализации и выбранный технический способ должны
  находиться в Design, а не заменять продуктовую постановку.
- Для каждого рассмотренного Code Repository проверить точный `repository-id`, тип
  `implementation | tests-only | configuration | documentation | no-change`,
  ожидаемый результат на границе репозитория и причину.

### Specs

- Проверить соответствие capability из Proposal, наблюдаемость Requirements,
  однозначность Scenarios и стабильные Scenario ID.
- Missing Design и Tasks не являются finding этой промежуточной стадии.
- Привлекать `openspec-base-project-context-researcher` только для одного спорного
  поведения. Не переносить техническую декомпозицию репозиториев в Requirements и
  Scenarios.

### Design

- Проверить, что каждое техническое решение связано с Requirement, Scenario или
  явным ограничением Proposal и объясняет влияние на наблюдаемое поведение.
- Если Design вводит новое или изменённое поведение, которого нет в Proposal и
  Specs, считать это `BLOCKER` и вернуть Change к уточнению Planning.
- Если Repository impact или границы систем изменились после Proposal, выполнить
  ограниченный impact-review по изменившейся области, не повторяя весь анализ.
- Использовать `openspec-base-repository-evidence-scout` с `evidence_kind:
  architecture` для одного вопроса о принадлежащей репозиторию стороне контракта,
  совместимости, security, миграции, rollout или rollback; с `evidence_kind:
  implementation` — только для подтверждения конкретной точки входа.
- Проверить согласованность Repository implementation map с Proposal и Specs.

### Tasks

- Проверить, что задача не добавляет поведение или scope, отсутствующие в принятых
  Planning-артефактах, а проверка подтверждает наблюдаемый результат там, где он
  применим.
- Проверить, что repository sections имеют в заголовке точный `repository-id`. Для
  общей секции должен быть указан owner либо однозначно определяться primary
  solution owner из Repository implementation map Design.
- Если неясны существующие уровни проверки или repository-specific evidence,
  использовать `openspec-base-repository-evidence-scout` с `evidence_kind:
  verification` отдельно для каждого репозитория. Не требовать implementation
  evidence, которого ещё не должно быть на Planning-стадии.
- Применять `openspec-base-test-cases`, только когда пользователь просит тест-кейсы
  либо проверка выявила неоднозначное тестовое покрытие. До вызова собрать необходимый
  repository evidence через scout и передать готовые `repository_evidence` outputs в
  evidence bundle; `test-cases` не собирает их через subagent самостоятельно. Не
  создавать нештатный файл автоматически.

### Impact Review

- Не выполнять этот режим до формирования продуктовой постановки. Если она
  неполна, вернуть Change на стадию Proposal.
- Прочитать только относящиеся к вопросу Master Specs, ADR, системную карту,
  контракты, конфигурацию, код и тесты.
- Проверить только применимые области: capability и поведение; системы,
  репозитории и владельцев данных; API, события, схемы и внешние зависимости;
  security, privacy и compliance; совместимость и миграцию; rollout, наблюдение,
  rollback и уровни проверки.
- Для каждого подтверждённого влияния указать `path:line` или точный
  Requirement/Scenario. Отделить факт, вывод, конфликт и неизвестное.
- Для каждого рассмотренного Code Repository указать точный `repository-id`, тип
  влияния, ожидаемое изменение, evidence и зависимости. Отдельно назвать
  проверенные `no-change` репозитории.
- Если требуется отдельное repository-specific исследование, передать repository
  evidence scout один вопрос и один `repository-id`; не поручать ему собирать
  межрепозиторный вывод.
- Сопоставить выводы с Proposal и Design и вернуть findings, но не редактировать
  артефакты.

### Planning Review

- Прочитать Proposal, все Delta Specs, Design, Tasks, соответствующие Master Specs и
  применимый project context.
- Выполнить штатную строгую неинтерактивную валидацию Change и отделить ошибки
  OpenSpec от семантических findings.
- Собрать review set: заявленные `repository-id`, подтверждённо затрагиваемые, но
  пропущенные репозитории, и обоснованные `no-change`.
- Проверить трассировку: источник → Why и scope → capability → Requirement →
  Scenario → Design decision → Task → план evidence.
- Для каждого репозитория проверить цепочку `Proposal impact → Design map → Tasks →
  verification plan`, входящие и исходящие контракты, зависимости, порядок работ и
  симметричность межрепозиторных изменений.
- Использовать `openspec-base-planning-reviewer` в режиме `planning-review` для
  одного независимого вопроса о полноте или согласованности. Для недостающего
  repository-specific evidence использовать `openspec-base-repository-evidence-scout`
  отдельно по каждому репозиторию. Не запускать все subagents формально.

## Выбор subagents

- Перед применением дополнительного project skill полностью прочитать его
  `SKILL.md`; перед делегированием subagent прочитать его профиль. Не
  восстанавливать контракт только по имени.
- Передавать каждому subagent один вопрос, точный Change, стадию и минимальный scope.
- Использовать `openspec-base-planning-reviewer` только в `planning-review` перед
  человеческим Gate либо для одного конкретного спорного finding, где требуется
  независимое второе мнение. Не запускать его как обязательное продолжение каждой
  стадийной проверки.
- Для context researcher и planning reviewer передавать абсолютный Planning Home и
  точный список разрешённых источников; planning reviewer дополнительно получает
  минимальный уже собранный evidence bundle.
- Для repository-specific вопроса полностью прочитать профиль
  `openspec-base-repository-evidence-scout` и сформировать его обязательный вход. Если
  входной контракт не выполнен, не запускать исследование.
- Не сообщать subagent предполагаемый ответ. Передавать исходный артефакт и вопрос,
  чтобы получить независимое evidence.
- Если нужный subagent недоступен, выполнить адресное read/search самостоятельно и
  явно назвать fallback. Repository-specific fallback обязан соблюдать входной
  контракт профиля `openspec-base-repository-evidence-scout`. Отсутствие subagent само
  по себе не блокирует проверку.

## Решение

Удалить дубликаты findings и классифицировать их:

- `BLOCKER` — артефакт противоречит подтверждённому intent, требованию, коду,
  контракту или обязательному правилу либо требует решения владельца;
- `WARNING` — риск или недостаток evidence должен быть явно принят;
- `NOTE` — улучшение, не мешающее следующему Planning-шагу.

Вернуть на русском:

```yaml
meta_planning:
  change: <change-id>
  stage: proposal | specs | design | tasks | impact-review | planning-review
  checks_used: []
  subagents_used: []
  findings:
    blockers: 0
    warnings: 0
    notes: 0
  check_status: ready | needs_revision | blocked
  next_action: continue | revise_current_artifact | request_owner_decision
```

После блока привести только относящиеся к выбранной стадии findings с evidence
`path:line` или Requirement/Scenario и требуемым решением. Для `impact-review`
добавить краткую матрицу влияния и репозиториев; для `planning-review` — краткую
матрицу трассируемости и покрытия репозиториев. `ready` означает только отсутствие
найденных препятствий в прочитанном scope, а не approval или успешную реализацию.
