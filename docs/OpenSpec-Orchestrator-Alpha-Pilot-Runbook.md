# OpenSpec Orchestrator: runbook пилота альфа-версии

## 0. Цель и границы

Статус: **готов к freeze вместе с Alpha Concept и Alpha Implementation Plan**.

Runbook проверяет две гипотезы:

1. Cycle сохраняет, какие репозитории и какая версия планирования приняты для Change.
2. Snapshot не даёт перепутать точные версии frontend и backend при общей проверке.

Пилот рассчитан на одного инженера, одну машину, один Store и два Code Repository.
Команды ниже применимы только после реализации
[Alpha Implementation Plan](OpenSpec-Orchestrator-Alpha-Implementation-Plan.md).
Текущий прототип до этого момента имеет другой CLI.

## 1. Выбор реального Change и паспорт прогона

Реальный Change выбирается до установки и сухого прогона. Нужно заранее
зафиксировать:

- название Change и конкретную рабочую задачу;
- владельца пилота;
- Store, frontend и backend;
- почему затронуты оба Code Repository;
- проверяемый результат, по которому Change можно завершить.

Если любой из этих пунктов не определён, пилот не начинается: выбор эксперимента не
должен занимать первый день прогона.

Перед началом зафиксировать реальные значения и дату ревизии feedback через 2–3
недели:

```bash
ORCH_CLI_ROOT=/absolute/path/to/multi-repo-specs
ORCH_WORKSPACE_ROOT=/absolute/path/to/pilot-workspace
ORCH_STORE_ROOT=/absolute/path/to/pilot-workspace/specs
ORCH_CHANGE_ID=checkout-flow
ORCH_FRONTEND_ID=frontend
ORCH_BACKEND_ID=backend
ALPHA_CONTRACT_SHA=$(git -C "$ORCH_CLI_ROOT" log -1 --format=%H -- \
  docs/OpenSpec-Orchestrator-Alpha-Concept.md \
  docs/OpenSpec-Orchestrator-Alpha-Implementation-Plan.md \
  docs/OpenSpec-Orchestrator-Alpha-Pilot-Runbook.md)
ORCH_CHANGE_KEY=$(node -e 'process.stdout.write(Buffer.from(process.argv[1], "utf8").toString("base64url"))' "$ORCH_CHANGE_ID")
ORCH_CYCLE_PATH=".openspec-orch/changes/${ORCH_CHANGE_KEY}.json"
```

В журнале пилота записать:

- дату и участника;
- `Alpha Pilot Contract SHA` — отдельный коммит трёх Alpha-документов;
- SHA реализации Orchestrator;
- `change-id`;
- Store, frontend и backend repository IDs;
- рабочую задачу и владельца пилота;
- дату ревизии `docs/alpha-feedback.md`.

Перед кодом и пилотом убедиться, что `$ALPHA_CONTRACT_SHA` содержит зафиксированные
версии Alpha Concept, Alpha Implementation Plan и Alpha Pilot Runbook. Во время
разработки эти три документа не редактируются.

## 2. Установка и подключение

Использовать способ локального запуска, описанный в README на
`$ALPHA_CONTRACT_SHA`. Для текущего Node.js-проекта это:

```bash
cd "$ORCH_CLI_ROOT"
npm install
npm run check
npm link
openspec-orch --help
```

Перейти в Store и подключить workspace:

```bash
cd "$ORCH_STORE_ROOT"
openspec-orch connect --workspace "$ORCH_WORKSPACE_ROOT"
openspec-orch repository status
```

Перед продолжением вручную подтвердить:

- Store, frontend и backend имеют статус `connected`;
- remote и default branch совпадают с `openspec-orch.yaml`;
- рабочие копии чистые;
- `repository status` ничего не изменил и не выполнил сетевых операций.

## 3. Создание Cycle

Сначала подготовить и закоммитить Change обычным процессом OpenSpec. После этого из
чистого Store выполнить:

```bash
cd "$ORCH_STORE_ROOT"
openspec-orch assign "$ORCH_CHANGE_ID" \
  --repo "$ORCH_FRONTEND_ID" \
  --repo "$ORCH_BACKEND_ID"
```

В preview проверить `change_id`, `planning_revision`, оба repository ID и путь Cycle
Record. Подтвердить запись, затем закоммитить только созданный Cycle Record обычным
Git-процессом команды:

```bash
git status --short
git add "$ORCH_CYCLE_PATH"
git commit -m "openspec: assign ${ORCH_CHANGE_ID} cycle"
openspec-orch status "$ORCH_CHANGE_ID"
```

Ожидаемый результат: `status` показывает Cycle и следующее действие — записать
результаты двух репозиториев. Путь `$ORCH_CYCLE_PATH` должен совпасть с путём из
вывода `assign`; при несовпадении остановить прогон как дефект контракта.

## 4. Запись результатов реализации

Реализация и проектные проверки выполняются вне Orchestrator. После чистого коммита
frontend получить SHA и записать Receipt:

```bash
ORCH_FRONTEND_SHA=$(git -C "$ORCH_WORKSPACE_ROOT/src/$ORCH_FRONTEND_ID" rev-parse HEAD)
cd "$ORCH_STORE_ROOT"
openspec-orch record assignment "$ORCH_CHANGE_ID" \
  --repo "$ORCH_FRONTEND_ID" \
  --commit "$ORCH_FRONTEND_SHA" \
  --status completed \
  --source human
```

После чистого коммита backend:

```bash
ORCH_BACKEND_SHA=$(git -C "$ORCH_WORKSPACE_ROOT/src/$ORCH_BACKEND_ID" rev-parse HEAD)
cd "$ORCH_STORE_ROOT"
openspec-orch record assignment "$ORCH_CHANGE_ID" \
  --repo "$ORCH_BACKEND_ID" \
  --commit "$ORCH_BACKEND_SHA" \
  --status completed \
  --source human
openspec-orch status "$ORCH_CHANGE_ID"
```

Ожидаемый результат: оба репозитория имеют статус `completed` с точными SHA, а
следующее действие — `verify`. `cycle_id` вручную не вводится.

## 5. Snapshot и проверка

Вычислить Snapshot:

```bash
cd "$ORCH_STORE_ROOT"
openspec-orch verify "$ORCH_CHANGE_ID"
```

Сверить, что вывод содержит именно `$ORCH_FRONTEND_SHA` и `$ORCH_BACKEND_SHA`.
Orchestrator не делает checkout и не запускает тесты: инженер самостоятельно
разворачивает эти версии безопасным Git-процессом команды и выполняет согласованные
проектные проверки.

После проверки записать результат:

```bash
cd "$ORCH_STORE_ROOT"
openspec-orch record verification "$ORCH_CHANGE_ID" \
  --result pass \
  --source human
openspec-orch status "$ORCH_CHANGE_ID"
```

Для неуспешной проверки использовать `--result fail` и короткий `--note`.

Ожидаемый итог: `status` показывает Cycle, оба Result Receipt, текущий Snapshot,
Verification Receipt и следующее действие `готово`.

## 6. Обязательные отрицательные проверки

На отдельном тестовом Change или временных репозиториях проверить безопасные отказы:

1. `record assignment` с несуществующим commit SHA не создаёт Receipt.
2. Receipt, подготовленный для старого Cycle, не принимается после нового `assign`.
3. `verify` блокируется, пока хотя бы один репозиторий не имеет `completed` Receipt.
4. `record verification` не принимает результат для предыдущего Snapshot после
   изменения одного Result Receipt.

После каждого отказа повторный `status` должен показывать последнее корректное
состояние без частичной записи.

## 7. Возврат и восстановление

Перезапустить процесс и повторить:

```bash
cd "$ORCH_STORE_ROOT"
openspec-orch status "$ORCH_CHANGE_ID"
openspec-orch verify "$ORCH_CHANGE_ID"
```

Ожидается тот же Cycle и тот же `snapshot_id`. Отдельно на копии локального state
проверить сценарий его потери: Cycle восстанавливается из Git, а Receipts честно
показываются как `missing`. Рабочий state пилота перед этой проверкой сохранить
вне проекта и затем вернуть обычным безопасным способом; runbook не предписывает
удалять единственную копию.

## 8. Обратная связь и завершение прогона

После каждого Change добавить в `docs/alpha-feedback.md` только наблюдаемые факты:

1. Где пришлось руками переносить контекст?
2. Где пользователь сомневался в следующем действии?
3. Где пользователь боялся ошибиться?

Для каждой записи указать дату, `change-id`, шаг runbook и короткое описание. Не
предлагать решение прямо во время прогона и не расширять альфу до ревизии feedback.

Пилот считается завершённым после 3–5 реальных Changes, когда:

- `status` восстанавливает Cycle после перезапуска;
- чужой Cycle и несуществующий commit отклоняются;
- одинаковый набор коммитов даёт одинаковый Snapshot;
- Verification Receipt нельзя привязать к другому Snapshot;
- feedback содержит реальные наблюдения либо явно фиксирует, что повторяющейся боли
  не обнаружено.
