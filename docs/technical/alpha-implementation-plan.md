# OpenSpec Orchestrator: план реализации альфа-версии

## 0. Статус и цель

Статус: **Alpha v1 реализована и заморожена до ревизии пилота**.

Нормативный источник: [Alpha Concept](alpha-concept.md).
План отвечает только на вопрос: что нужно сделать, чтобы проверить ценность Cycle и
Snapshot на реальных изменениях. Он не является планом полной версии продукта.

Точка отсечения альфы:

```text
change-id
  → Cycle с planning_revision и репозиториями
  → Result Receipts с точными коммитами
  → детерминированный Snapshot
  → Verification Receipt pass/fail
```

После выполнения этапа 4 разработка останавливается и начинается пилот по
[runbook](../user/pilot-runbook.md). Новые функции до ревизии
`docs/user/pilot-feedback.md` не добавляются.

## 1. Публичный поток альфы

Публичный набор ограничен восемью операциями:

```text
openspec-orch init [path] --store <id> --agent <id> [--template <path>] [--repo <id=remote#branch>]...
openspec-orch connect [--workspace <path>]
openspec-orch repository status [--repo <repository-id>]...

openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id>
openspec-orch record assignment <change-id> --repo <repository-id> --commit <sha> --status <completed|failed|blocked> --source <human|agent|ci> [--note <text>]
openspec-orch verify <change-id>
openspec-orch record verification <change-id> --result <pass|fail> --source <human|agent|ci> [--note <text>]
```

`--agent` и `--template` у `init` нужны только для существующей bootstrap-установки
проектных файлов. Alpha Core не хранит agent mapping в новой конфигурации и не
использует handoff после `init`.

Команды записи работают интерактивно: сначала показывают будущую запись, затем
запрашивают подтверждение. Неинтерактивные confirmation token и единый `--json`
контракт в альфу не входят.

Минимальные коды завершения: `0` — успешная операция или отказ пользователя от
preview без записи; `1` — ошибка проверки или выполнения; `2` — неверный вызов CLI.
Причина ошибки печатается в stderr одним из стабильных кодов раздела 6 Alpha Concept.

## 2. Ограничения продукта и выбор реализации

Alpha Concept задаёт ограничения продукта. Этот план отдельно фиксирует сменяемые
технические решения текущей Node.js-реализации:

| Ограничение продукта | Выбор реализации Alpha v1 |
|---|---|
| `change-id` безопасно и обратимо отображается в имя файла | `change-key` — base64url от UTF-8 без padding; исходный `change_id` повторяется в Cycle Record |
| Каждый новый Cycle и Receipt имеет уникальный ID | UUIDv4 из `node:crypto` с префиксами `cycle-`, `result-`, `verification-` |
| Форматы версионированы и неизвестные поля отклоняются | Строгие Zod-схемы, уже используемые в проекте |
| Одинаковые входы дают одинаковый Snapshot | `snap-v1-<sha256>` от фиксированной UTF-8 JSON-проекции |
| Диагностические данные не меняют идентичность | `created_at` в RFC 3339 UTC не входит в ID или хеш |
| Ошибка записи не повреждает последнее корректное состояние | Временный файл в том же каталоге и atomic rename; mode `0600` для state |
| Старое runtime-состояние нельзя выдавать за Cycle или Receipt | Автомиграции нет; pilot config переводится вручную по проверяемому diff |

Для `snapshot_id` проекция имеет фиксированный порядок ключей `hash_version`,
`contract_version`, `cycle_id`, `implementations`; массив `implementations` состоит
из `repository_id + implementation_revision` и сортируется по `repository_id`.
Технический выбор можно заменить только вместе с версией соответствующего формата,
не меняя продуктовое ограничение.

## 3. Этап 0. Зафиксировать основу

Цель: понять, какие части прототипа можно переиспользовать без переноса старой
продуктовой модели.

Работы:

1. Зафиксировать Alpha-документы и реализацию в Git. Во время пилота эти документы
   не редактируются; наблюдения идут только в `docs/user/pilot-feedback.md`.
2. Зафиксировать полный результат `npm run check`.
3. Характеризовать текущие `init` и `connect`, разбор `openspec-orch.yaml`, Git/path
   helpers и атомарную запись `context.json`.
4. Зафиксировать расхождения текущего прототипа и Alpha Concept:
   старые `role/url/agent`, Git config для workspace, отсутствие Cycle/state и
   публичные `explore/change/load`.
5. Выбрать переиспользуемые модули. Не проектировать новую модульную архитектуру.
6. Записать точные форматы Alpha v1 для config, Cycle Record, state, Result Receipt,
   Snapshot и Verification Receipt по разделу 3 Alpha Concept.

Критерий выхода: есть проверенная база, список переиспользуемого кода и контрактные
fixtures; ни одна функция следующей версии не попала в объём работ.

## 4. Этап 1. Основа Cycle

Цель: по `change-id` восстановить принятую версию планирования и состав репозиториев.

Реализовать:

1. Строгий `openspec-orch.yaml` Alpha v1: `version`, `strict`, `repositories`,
   `extensions`; ровно один `store`, минимум один `code` для пилота.
2. Перенос локального workspace из Git config в `.openspec-orch/state.json`.
3. Сохранение текущих безопасных свойств `init` и `connect`.
4. Read-only `repository status`: наличие checkout, clean/dirty, remote и ветка;
   без clone/fetch/pull/checkout и без исправлений.
5. Cycle Record в `.openspec-orch/changes/<base64url-change-id>.json`.
6. `assign` с чистым Store, preview, подтверждением, атомарной записью и новым
   `cycle_id` при изменении `planning_revision` или состава репозиториев.
7. `status` из Cycle Record в `HEAD` текущей рабочей копии Store, включая
   предупреждение о незакоммиченной записи и одно следующее действие.

Не реализовывать: состояния активации, чтение основной ветки, repository
fingerprints, `adopt`, `plan`, `implement`, Handoff и автоматические Git-операции.

Минимальные проверки:

- неизвестная версия или поле config/Record отклоняется;
- неизвестный или повторяющийся repository ID отклоняется;
- dirty Store и незавершённая Git-операция блокируют `assign`;
- повторный `assign` с теми же входами идемпотентен;
- изменение входов создаёт новый Cycle только после предупреждения;
- `status` после перезапуска процесса восстанавливает тот же Cycle.

Критерий выхода: `assign → ручной Git commit → status` устойчиво показывает
`change-id`, `cycle_id`, `planning_revision`, репозитории и следующее действие.

## 5. Этап 2. Учёт результатов

Цель: сохранить точный коммит результата каждого репозитория Cycle.

Реализовать:

1. Версионированный `.openspec-orch/state.json` с атомарной записью и проверкой при
   чтении; файл добавляется в `.gitignore`.
2. Result Receipt и `record assignment`.
3. Проверки совпадения текущего `cycle_id`, принадлежности репозитория Cycle и
   существования коммита в локальном checkout.
4. Статусы `completed | failed | blocked` и источник `human | agent | ci`.
5. Замена текущего Receipt с предупреждением и сохранением предыдущего в локальной
   истории.
6. Таблица Receipt и следующее действие в `status`.

Не реализовывать: `supersedes`, общий между машинами state, evidence graph,
неполученные автоматически commit SHA и dirty/uncommitted result.

Минимальные проверки:

- чужой Cycle, чужой репозиторий и несуществующий SHA отклоняются без записи;
- Receipt другого Cycle не становится текущим;
- потеря state не ломает Cycle и даёт честный `missing`;
- повреждённый state не перезаписывается молча;
- повторная запись явно отражается в истории.

Критерий выхода: `status` после перезапуска показывает точный результат каждого
репозитория. Это минимальная демонстрируемая точка отсечения при нехватке времени.

## 6. Этап 3. Snapshot и Verification Receipt

Цель: получить воспроизводимую идентичность проверяемого набора коммитов.

Реализовать:

1. `verify`, доступный только когда каждый репозиторий Cycle имеет текущий Receipt
   со статусом `completed`.
2. Каноническую сортировку `repository_id + implementation_revision` и
   версионированный алгоритм `snapshot_id`.
3. Сохранение Snapshot в локальном state и вывод таблицы точных коммитов.
4. `record verification` со значениями `pass | fail`.
5. Обязательное совпадение `cycle_id` и последнего `snapshot_id`.
6. Snapshot, Verification Receipt и следующее действие в `status`.

Не реализовывать: создание worktree, checkout, запуск тестов, отпечаток договора
проверки, `error/inconclusive`, Handoff Envelope и CI-интеграцию.

Минимальные проверки:

- неполный или неуспешный набор Result Receipts блокирует `verify`;
- одинаковые входы дают одинаковый `snapshot_id` после перезапуска;
- время, путь и машина не влияют на `snapshot_id`;
- новый Result Receipt меняет Snapshot;
- Verification Receipt для другого Cycle или Snapshot отклоняется.

Критерий выхода: `verify → внешняя проверка → record verification → status` даёт
точный Snapshot и честный `pass/fail`, не выдавая его за запуск тестов или release
approval.

## 7. Этап 4. Подготовка пилота

Цель: передать альфу одному инженеру без дополнительного устного проектирования.

Подготовить:

1. До начала пилота выбрать реальный Change: название и задача, Store, frontend и
   backend repository IDs, а также понятный критерий завершения.
2. README, который чётко разделяет текущий реализованный Alpha CLI и архив полной
   модели.
3. Актуальный пример `openspec-orch.yaml` и команды установки.
4. `docs/user/pilot-feedback.md` с тремя вопросами из Alpha Concept.
5. Пилот по [runbook](../user/pilot-runbook.md) на Store,
   frontend и backend.
6. Один сухой прогон и один реальный Change; отрицательные сценарии — чужой Cycle,
   несуществующий commit, неполный Snapshot и неверный Snapshot Receipt.

Критерий выхода: один инженер проходит цепочку без ручного ввода `cycle_id`,
`snapshot_id` и списка коммитов; все ручные переносы контекста записаны в feedback.

## 8. Сквозные правила и определение готовности

Для каждого этапа обязательны:

- unit-тесты новых форматов и вычислений;
- интеграционные тесты на временных Git-репозиториях;
- негативные тесты без частичной записи;
- `npm run check` и `git diff --check`;
- проверка, что Core не выполняет `git add/commit/push/merge/rebase/checkout`, не
  запускает проектные проверки и не читает внутреннюю структуру OpenSpec.

Alpha v1 готова к пилоту, только если выполнены критерии выхода этапов 0–4 и четыре
неснижаемые проверки раздела 2.3 Alpha Concept. Публикация пакета, второй командный
пилот, migration plan и Beta Plan не являются условиями готовности альфы.
