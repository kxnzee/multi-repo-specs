---
name: openspec-base-apply-context
description: Подготовить repository-scoped контекст для штатного OpenSpec Apply по принятому Cycle. Использовать внутри /opsx:apply перед изменением кода, когда Change хранится в центральном Store, а реализация распределена по Code Repositories. Проверять текущий repository-id, участие в Cycle, неизменность принятого Planning и выбирать только принадлежащие текущему репозиторию секции Tasks. Не заменять встроенный openspec-apply-change.
---

# Repository-scoped контекст Apply

Ограничить один запуск штатного Apply текущим Code Repository. Не создавать новый
implementation workflow и не изменять встроенные `openspec-*` skills или `opsx-*`
commands.

## Preflight

1. Определить Change через штатный `openspec status --change "<change-id>" --json`
   и получить Apply-контекст командой `openspec instructions apply --change
   "<change-id>" --json`. Использовать возвращённые `changeDir`, `contextFiles`,
   Tasks и project `context`, не собирать пути вручную.
2. Из текущего рабочего каталога выполнить `openspec-orch status "<change-id>"
   --json`.
3. Остановить Apply со статусом `blocked`, если:
   - Cycle Record не закоммичен;
   - `current_repository` отсутствует или имеет role `store`;
   - `current_repository.in_cycle` не равен `true`;
   - repository identity или OpenSpec pointer не прошли проверку Core.
4. Если сессия открыта не из Code Repository, предложить открыть персональный
   OpenSpec Workset, где Code Repository является первым member, а Store — вторым.

## Целостность принятого Planning

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

Не запускать полный `/opsx:verify` после каждого checkbox: task-level gate использует
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
  cycle: <cycle-id>
  planning_revision: <sha>
  planning_integrity: exact | progress-only
  repository: <repository-id>
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
