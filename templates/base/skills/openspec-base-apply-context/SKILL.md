---
name: openspec-base-apply-context
description: Выбрать standard или orchestrated режим штатного OpenSpec Apply и подготовить repository-scoped контекст для принятого Cycle. Использовать внутри штатного Apply перед изменением кода, когда Change хранится в центральном Store. При CYCLE_NOT_FOUND предлагать обычный Apply без Orchestrator либо создание Cycle; при существующем Cycle проверять его через OpenSpec Graph, выбирать Tasks текущего репозитория и использовать CodeGraph только для локальной навигации по коду. Не заменять встроенный openspec-apply-change.
---

# Repository-scoped контекст Apply

Сохранить обычный OpenSpec Apply доступным для Change без Cycle и ограничить Apply
текущим Code Repository, когда пользователь включил Orchestrator созданием Cycle.
Не создавать новый implementation workflow и не изменять встроенные `openspec-*`
skills или `opsx-*` commands.

Быть leaf-skill: не вызывать project skills, project commands или subagents.
Передача подготовленного scope встроенному `openspec-apply-change` не является
project orchestration.

## Preflight

1. Определить Change через штатный `openspec status --change "<change-id>" --json`
   и получить Apply-контекст командой `openspec instructions apply --change
   "<change-id>" --json`. Использовать возвращённые `changeDir`, `contextFiles`,
   Tasks и project `context`, не собирать пути вручную.
2. Из текущего рабочего каталога выполнить `openspec-orch status "<change-id>"
   --json`.
3. Классифицировать результат `status`:
   - успешный ответ с Cycle — продолжить в orchestrated-режиме;
   - только ошибка `CYCLE_NOT_FOUND` — перейти к выбору режима ниже;
   - любая другая ошибка — остановить Apply со статусом `blocked`. Не трактовать
     недоступную команду, повреждённый state, ошибку repository identity или иной
     сбой как отсутствие Cycle.
4. В orchestrated-режиме остановить Apply со статусом `blocked`, если:
   - Cycle Record не закоммичен;
   - `current_repository` отсутствует или имеет role `store`;
   - `current_repository.in_cycle` не равен `true`;
   - repository identity или OpenSpec pointer не прошли проверку Core.
5. Если сессия открыта не из Code Repository, предложить открыть персональный
   OpenSpec Workset, где Code Repository является первым member, а Store — вторым.

## Выбор режима без Cycle

Если `status` завершился именно с `CYCLE_NOT_FOUND`, не блокировать штатный Apply и
не создавать Cycle автоматически. Предложить пользователю два явных варианта:

1. **Standard OpenSpec Apply** — продолжить встроенный `openspec-apply-change` без
   repository scope, Planning pin, Result Receipts и Snapshot Orchestrator.
2. **Orchestrated Apply** — остановиться до изменения кода и предложить создать и
   закоммитить Cycle обычной командой `openspec-orch assign` из Store.

Если пользователь уже явно выбрал standard-режим в текущем запросе, не спрашивать
повторно. В standard-режиме вывести следующий контракт и передать встроенному Apply
исходные `contextFiles`, Tasks и project context без repository-фильтрации:

```yaml
apply_mode:
  change: <change-id>
  mode: standard
  orchestration: disabled
  reason: CYCLE_NOT_FOUND
```

Не вызывать для standard-режима проверки целостности Cycle из следующих разделов,
не создавать фиктивные Receipts и не предлагать `record assignment` или `verify`.
Явно предупредить, что встроенный Apply самостоятельно определяет доступный scope и
что воспроизводимый multi-repository Snapshot в этом режиме отсутствует.

Если пользователь выбрал orchestrated-режим, не продолжать встроенный Apply в этой
сессии: вывести требуемое следующее действие `openspec-orch assign` и дождаться
закоммиченного Cycle. Если Cycle существует, не предлагать standard-режим как обход
его guardrails: Change завершается в orchestrated-режиме либо сначала получает
отдельное явное человеческое решение об отмене Cycle вне этого skill.

## Целостность принятого Planning

Этот и следующие разделы до передачи управления применять только в
orchestrated-режиме.

1. Взять `planning_revision` только из JSON-ответа Orchestrator и проверить наличие
   commit через Git без сети.
2. Сравнить текущий `changeDir` с тем же каталогом в `planning_revision`, включая
   staged, unstaged и untracked paths.
3. Классифицировать состояние:
   - `exact` — файлы Change совпадают;
   - `progress-only` — отличаются только маркеры `[ ]`/`[x]` существующих строк
     выбранных задач в Tasks; остальной текст и набор файлов совпадают;
   - `drift` — любое другое отличие.
4. При `drift` не изменять код и вернуть Change в Planning: требуется человеческий
   Gate и новый Cycle. Не считать добавление, удаление, перестановку или изменение
   текста задачи обычным progress.

## Подтверждение Cycle через OpenSpec Graph

Выполнить после проверки принятого Planning и до выбора задач текущего репозитория.
OpenSpec Graph определяет межрепозиторный scope; он не используется для поиска
файлов или символов внутри Code Repository.

1. Из Store выполнить `openspec-orch graph status --json`. Продолжать только при
   `state: ready`. Отсутствующая команда или binding, `stale` и `unavailable` —
   blocker до изменения кода. Не запускать `graph build` автоматически и не читать
   `openspec/graph.yaml` как обход; вернуть пользователю точную команду
   `openspec-orch graph build`.
2. Выполнить `openspec-orch graph impact "<change-id>"`, затем
   `openspec-orch graph check-scope "<change-id>"`, передав отдельный `--repo` для
   каждого точного значения из `repositories` ответа `openspec-orch status`. Не
   добавлять и не удалять repositories при формировании команды.
3. Считать блокирующими ошибку команды, `state: invalid`, непустые
   `missing_required_repositories` или `unmapped_master_specs`, а также
   `missing_delta_specs: true`. Такой Cycle не соответствует принятому Change и
   должен вернуться в Planning; не исправлять его во время Apply.
4. `review_repositories_outside_scope` может остаться вне Cycle только при явном
   evidence и решении `no-change` в принятом Planning. Для каждого
   `extra_repositories` требуется зафиксированная в Proposal, Design или Tasks роль
   в реализации или проверке. Необъяснённое расхождение считать blocker, даже если
   `check-scope` вернул `ready`; review-репозитории не включать автоматически.
5. Классифицировать текущий repository как `direct`, `review` или `extra` по
   результату `check-scope` и сохранить эту классификацию в `apply_scope`. Граф
   подтверждает только принадлежность scope; право изменять код по-прежнему задают
   Cycle и repository-owned Tasks.

## Выбор repository scope

1. Прочитать полный файл из `contextFiles.tasks`; не использовать плоский массив
   `tasks` без заголовков как источник ownership.
2. Считать repository section заголовок, содержащий точный `repository-id` из Cycle,
   например `## 2. jitsi-web: ...`. Выбрать только sections текущего
   `current_repository.repository_id`.
3. Для явно общей секции использовать указанного в ней owner. Если owner не указан,
   назначить её primary solution owner, однозначно указанному первым в Repository
   implementation map Design. Если такого владельца нельзя определить, остановиться
   и запросить решение, не распределять задачи эвристически.
4. Не выполнять и не отмечать задачи sections других Code Repositories. Зависимость
   от их evidence считать blocker текущей задачи, пока evidence не предоставлен.

## Навигация по коду текущего Repository

После подтверждения Cycle использовать CodeGraph только как необязательный быстрый
индекс внутри `current_repository.path`. OpenSpec Graph и CodeGraph не читают данные
друг друга: skill связывает их только через подтверждённый `repository-id` и путь из
Orchestrator status.

1. До первого изменения кода проверить точный Git root, repository identity, полный
   `HEAD` и чистоту worktree. Несовпадение identity блокирует Apply. Уже изменённый
   worktree не очищать: сохранить пользовательские изменения и не использовать для
   него CodeGraph как исходный индекс. Если для repository подключён CodeGraph,
   проверить `openspec-orch plugin status --plugin codegraph --repo <repository-id>`.
2. Если в корне существует `.codegraph/`, status равен `ready` и MCP
   `codegraph_explore` доступен, сначала запросить относящиеся к выбранным Tasks
   символы и пути с `projectPath: current_repository.path`. Не обращаться этим
   запросом к другим repositories Cycle.
3. Если индекс отсутствует, `stale`, `unavailable`, не покрывает язык либо MCP
   недоступен, не блокировать Apply: использовать адресный read/search в том же
   checkout и указать `code_navigation: fallback`. Не запускать `plugin sync`
   автоматически.
4. После изменения файлов проверять актуальный diff, код и тесты напрямую. Рёбра
   CodeGraph помогают найти точки влияния, но не являются evidence реализации,
   runtime-поведения или успешной проверки.

## Evidence gate для checkbox

Перед каждым переключением выбранной задачи из `[ ]` в `[x]` сформировать
`task_evidence` и проверить заявленный результат задачи, а не только наличие
похожего изменения:

```yaml
task_evidence:
  task_id: <id>
  claim: <проверяемый результат задачи>
  artifacts: []
  checks: []
  status: satisfied | blocked
```

1. В `artifacts` перечислить существующие пути, diff или внешние ссылки, которые
   непосредственно доказывают результат. Ответ агента в чате сам по себе не является
   durable artifact, если задача явно не требует только отчёт в текущей сессии.
2. В `checks` перечислить реально выполненные команды или ручные проверки и их
   результат. План проверки, предполагаемое поведение и статический вывод не считать
   выполненной runtime/manual verification.
3. Для задачи, требующей добавить или изменить тест:
   - найти соответствующий test-файл в текущем diff;
   - подтвердить, что тест проверяет заявленное поведение;
   - выполнить наиболее узкую доступную test-команду и получить успешный результат.
   Отсутствие test-инфраструктуры, test-файла или успешного запуска означает
   `status: blocked`; не отмечать задачу выполненной и не заменять тест рассуждением.
4. Для implementation-задачи подтвердить относящийся к ней diff и релевантную
   проверку. Для документации или evidence package подтвердить durable artifact либо
   явно указанную внешнюю ссылку. Для условного `no-change` зафиксировать evidence,
   которое удовлетворяет условию самой задачи.
5. Переключать checkbox только при `status: satisfied`. Если evidence недоступно,
   оставить `[ ]`, назвать blocker и не объявлять repository scope завершённым.
6. Перед завершением Apply повторно проверить все checkbox, переключённые текущей
   сессией. Если evidence не подтверждается, вернуть такой checkbox в `[ ]`.
   Существовавший до сессии `[x]` без доступного evidence не менять молча: остановить
   scope и запросить ссылку на evidence или решение человека.

Не запускать полный штатный OpenSpec Verify после каждого checkbox: task-level gate использует
узкую проверку, а независимый Verify остаётся проверкой завершённого Snapshot.

## Передача управления штатному Apply

- Вернуть встроенному `openspec-apply-change` выбранные task IDs, текущий
  repository-id, `planning_revision` и `planning_integrity`.
- Разрешить изменения кода только внутри текущего Code Repository. Перед работой
  прочитать его локальные инструкции агента и использовать его команды test/lint.
- В центральном Store разрешить только переключение checkbox выбранной завершённой
  задачи. Proposal, Specs, Design и текст Tasks не изменять.
- Отмечать задачу выполненной только после `task_evidence.status: satisfied`.
- Перед Result Receipt вывести `repository_completion` со списками `satisfied_tasks`,
  `blocked_tasks` и выполненных проверок. При непустом `blocked_tasks` не предлагать
  `status: completed` для Result Receipt.
- После завершения repository scope остановиться. Не объявлять весь Change
  реализованным, пока в других sections остаются незавершённые задачи.

Перед продолжением Apply вывести:

```yaml
apply_scope:
  change: <change-id>
  mode: orchestrated
  cycle: <cycle-id>
  planning_revision: <sha>
  planning_integrity: exact | progress-only
  graph_status: ready
  cycle_scope_check: ready
  repository: <repository-id>
  repository_impact: direct | review | extra
  code_navigation: codegraph | fallback
  selected_tasks: []
  excluded_repositories: []
  scope_status: ready | blocked
```

После выполнения выбранного scope вывести:

```yaml
repository_completion:
  repository: <repository-id>
  satisfied_tasks: []
  blocked_tasks: []
  checks: []
  completion_status: completed | incomplete
```
