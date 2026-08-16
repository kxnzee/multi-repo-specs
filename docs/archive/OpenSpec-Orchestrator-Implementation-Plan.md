# OpenSpec Orchestrator: план реализации v1

> [!CAUTION]
> **Архивный документ.** План описывает реализацию полной модели v1 и не должен
> использоваться как текущая последовательность работ. Актуальный порядок ограничен
> [Alpha Implementation Plan](../OpenSpec-Orchestrator-Alpha-Implementation-Plan.md).

## 0. Статус и основание

Статус: **архивный план полной версии; заменён Alpha Implementation Plan**.

Историческое основание: [полная продуктовая концепция](OpenSpec-Orchestrator-Product-Concept-Brief.md), редакция 3.

Аудит текущего кода выполнен 16 августа 2026 года на коммите `d2d657322f7ac67609c0bd30765a29e822c64673` с незафиксированными изменениями документации. Поэтому перед первым изменением кода нужно:

1. зафиксировать концепцию и этот план отдельным коммитом;
2. записать SHA этого коммита в техническую задачу этапа 0;
3. убедиться, что рабочее дерево не содержит посторонних изменений.

План определяет порядок и проверяемые результаты. Он не может менять владельцев данных, три иерархических слоя, идентичность Cycle или границы v1.

## 1. Фактическое состояние прототипа

### 1.1. Что уже есть

- Node.js `>=20.5`, ESM, Commander, Zod, YAML, Execa и Inquirer.
- Публичные команды `init`, `connect`, `explore`, `change`, `load` в `src/cli/program.js`.
- Разделение CLI-обработчиков и модулей `src/internal/*`.
- Безопасные примитивы Git, проверки путей, атомарная запись `context.json` и работа с отсоединённым Store worktree.
- Вызов публичного OpenSpec CLI и структурная проверка его JSON-ответов.
- Встроенный Project Template и дескриптор пользовательского Template.
- 141 Node-тест успешно проходит на момент аудита; этап 0 фиксирует точный вывод прогона для implementation base SHA.

### 1.2. Что не совпадает с целевым v1

| Сейчас | Целевое состояние | Действие |
|---|---|---|
| `init`, `connect`, `explore`, `change`, `load` | `init`, `adopt`, `connect`, `repository status`, `plan`, `assign`, `status`, `implement`, `record assignment`, `verify`, `record verification` | Сохранить устойчивые примитивы, заменить публичный поток |
| `change` создаёт/продолжает Change и может управлять веткой | OpenSpec/Template владеет созданием Change | Убрать из Core; не переносить Git workflow |
| `load` требует `--baseline` и Work Package ID | `implement` сам восстанавливает Cycle и Assignment | Переиспользовать worktree/runtime, удалить ручной Baseline/Work Package из контракта Core |
| `strict`/`--no-strict`, в relaxed mode есть `unpinned` | Только точные чистые коммиты | Удалить relaxed mode из целевых операций; не мигрировать `unpinned` |
| `role: store|code`, `url` | `roles: [store|code]`, включая `store+code`, `remote` | Версионировать и мигрировать конфиг |
| `agent.handoffs` — простые пути | Типизированные Mapping: `markdown-command|skill|manual` | Ввести `entrypoint`, `contract_inputs` и отпечаток договора |
| Нет Cycle Record и `.openspec-orch/state.json` | Git-tracked Cycle + локальные Receipts/Snapshot | Добавить два разных контракта хранения |
| JSON неодинаков между командами | Единый версионированный конверт ответа | Ввести общую границу CLI |

[`full-prototype/BACKLOG.md`](full-prototype/BACKLOG.md) и прежняя редакция README
описывали предыдущий v1. Они должны оставаться явно помеченными как описание
прототипа.

## 2. Обязательные технические контракты

### 2.1. Публичная грамматика CLI

```text
openspec-orch init [path] --store <id> --agent <id> [--template <path>] [--repo <id=remote#branch>]...
openspec-orch adopt [path] [--agent <id>] [--mapping <file>]
openspec-orch connect [--workspace <path>]
openspec-orch repository status [--repo <repository-id>]...

openspec-orch plan <change-id>
openspec-orch assign <change-id> --repo <repository-id>... [--expected-cycle <cycle-id>] [--replace]
openspec-orch status <change-id> [--repo <repository-id>]...

openspec-orch implement <change-id> [--repo <repository-id>] [--expected-cycle <cycle-id>]
openspec-orch record assignment <change-id> --receipt <file|-> [--expected-cycle <cycle-id>]

openspec-orch verify <change-id> [--expected-cycle <cycle-id>]
openspec-orch record verification <change-id> --receipt <file|-> --expected-snapshot <snapshot-id>
```

Общие флаги: `--json`; для операций с записью — `--confirm <preview-token>`. Первый неинтерактивный вызов без токена возвращает `needs_confirmation` и не меняет данные. `--confirm` принимается только при совпадении отпечатка предварительного просмотра.

`--replace` нужен только для явного нового Cycle при уже активном Cycle. Он не переносит старые Receipts. `expected-cycle` и `expected-snapshot` — только предохранители, а не способ выбрать исторический объект.

### 2.2. Конфигурация

Целевая схема точно следует минимальному примеру из раздела 6.2 концепции. Zod-схема должна:

- быть строгой для всех известных объектов;
- разрешать проектные данные только в `extensions`;
- требовать ровно один Store и не менее одной роли на репозиторий;
- запрещать credential, абсолютные локальные пути, `..` и выход через символические ссылки;
- перечитываться при каждой команде.

Мигратор v1 преобразует `role` в `roles`, `url` в `remote`, а строки `agent.handoffs.<name>` в объекты `markdown-command`. Он показывает diff и требует подтверждения. `strict: false`, неоднозначный handoff и неизвестное поле останавливают автоматическую миграцию и требуют ручной правки.

### 2.3. Cycle Record и выбор текущего Cycle

Нормативный путь: `.openspec-orch/changes/<encoded-change-id>.json`. Кодирование — обратимый base64url от UTF-8 `change-id` без padding и без изменения регистра; внутри файла всегда повторяется исходный `change_id`.

Поля идентичности: `contract_version`, `cycle_id`, `change_id`, `planning_revision`, отсортированный список `{repository_id, repository_fingerprint}`. `cycle_id` — UUIDv4 из `node:crypto`; порядок Cycle не выводится из ID. Канонический JSON и отпечатки версионируются полем `hash_version`; ключи сортируются, массив репозиториев сортируется по `repository_id`.

Авторитетная локальная ссылка v1 — `refs/remotes/<remote-name>/<default_branch>` Store. `<remote-name>` определяется по единственному Git remote, чей канонический URL совпадает с `repositories[].remote`; имя `origin` не хардкодится. Ноль или несколько совпадений — ошибка идентичности. Core не вызывает `fetch` скрыто: вывод всегда показывает ref и её SHA. Если ref отсутствует, это `error`, а не переход на текущую ветку.

Алгоритм:

1. Разрешить точный SHA авторитетной ref.
2. Прочитать только `<ref>:<normative-path>`.
3. Если файл отсутствует, текущего Cycle нет. История не просматривается.
4. Разобрать строгую схему, проверить `change_id`, `cycle_id`, отпечатки и достижимость `planning_revision` из ref.
5. При успехе эта запись — единственный `active` и `current: true` Cycle.
6. Отдельно сравнить working tree и `HEAD` с авторитетным файлом, чтобы показать `pending` или `committed_pending`. Эти кандидаты не заменяют текущий Cycle.

Объединение, squash или rebase не важны, если итоговое содержимое по пути корректно. Старые версии в истории получают `current: false` и никогда не участвуют в выборе.

### 2.4. Локальное состояние и подтверждения

`.openspec-orch/state.json` имеет свою `contract_version` и хранит только локальные пути, Result Receipts, материализованные Snapshot и Verification Receipts. Файл игнорируется Git, пишется через временный файл + `fsync` + rename и защищается эксклюзивной lock-записью с PID, временем и nonce. Устаревшая lock не удаляется автоматически без явного восстановления.

Result Receipt содержит `receipt_id`, `contract_version`, `cycle_id`, `repository_id`, `implementation_revision`, `source`, evidence, `handoff_envelope_hash`, `supersedes?`. Verification Receipt содержит `receipt_id`, `contract_version`, `cycle_id`, `snapshot_id`, `verification_contract_fingerprint`, `outcome`, `source`, evidence, `supersedes?`. Отметка времени не выбирает текущий Receipt.

Snapshot детерминированно вычисляется из `contract_version`, `cycle_id`, отсортированных `{repository_id, implementation_revision}` и `verification_contract_fingerprint`. Время, машина и локальные пути в ID не входят.

### 2.5. Вывод и коды завершения

Все команды в `--json` возвращают один объект `{api_version, command, outcome, data, warnings, next_actions}`. `outcome`: `ok`, `needs_confirmation`, `blocked`, `error`. Stdout содержит только JSON; диагностика и progress идут в stderr.

Коды: `0` — `ok`; `2` — некорректный вызов; `3` — `needs_confirmation`; `4` — контрольное условие не выполнено; `5` — несовместимый внешний контракт; `1` — неклассифицированная ошибка. Каждая причина имеет стабильный `reason_code`.

## 3. Этапы реализации

Каждый этап завершается отдельным проверяемым коммитом. Нельзя начинать следующий этап, пока не выполнен его критерий выхода.

### Этап 0. Базовые контракты и характеризация

1. Зафиксировать implementation base SHA и вывод `npm run check`.
2. Добавить характеризационные тесты текущих `init`, `connect`, `load`, Git/path/OpenSpec helpers.
3. Проверить установленную версию OpenSpec и сохранить матрицу фактических публичных JSON-возможностей.
4. Если для Change или точного worktree нет публичной возможности, остановить этап: закрытую структуру файлов использовать нельзя.
5. Ввести общие JSON/error/confirmation-контракты, atomic write и lock.
6. Создать строгие Zod-схемы config, Cycle Record, state, Envelope, Receipts и Snapshot.

Тесты: неизвестные поля, неподдерживаемые версии, обрыв записи, конкурентная запись, изменённый preview, символическая ссылка.

Критерий выхода: все публичные данные и ошибки имеют версионированную схему; неизвестной зависимости от OpenSpec нет.

### Этап 1. Слой репозиториев

1. Сохранить безопасную установку Template в `init`, но перевести её на новый config.
2. Реализовать `adopt` без перезаписи OpenSpec config, схемы, команд, навыков и инструкций.
3. Перевести `connect` на множество ролей и точные Repository Fingerprints.
4. Реализовать read-only `repository status` без clone, fetch, pull и правок.
5. Записывать точный workspace только в локальное состояние; мигрировать `openspec-orch.workspace` из Git config.

Тесты: новый проект, существующий OpenSpec-проект, `store+code`, неверный remote, отсутствующая ветка, dirty checkout, незавершённая Git-операция, неоднозначный Mapping.

Критерий выхода: `init|adopt → connect → repository status` восстанавливает рабочее пространство и не меняет процесс Template/OpenSpec.

### Этап 2. Слой общего изменения: Cycle

1. Реализовать `plan` как передачу контекста без записи Cycle.
2. Реализовать `assign`: чистый Store, публичная проверка OpenSpec Change, preview, confirmation, atomic pending Record.
3. Реализовать точный алгоритм current Cycle из раздела 2.3.
4. Вычислять Assignment как `cycle_id + repository_id`, не сохранять его отдельно.
5. Реализовать `status(change-id)` с `phase`, `condition`, `reason_code`, `current`, происхождением ref и next action.

Тесты: первый Cycle, идемпотентный `assign`, явный `--replace`, неверный `expected-cycle`, pending поверх active, committed pending, два Record в истории, удалённый текущий Record, rebase/squash/merge, недостижимая `planning_revision`, переписанный `cycle_id`, устаревшая remote-tracking ref.

Критерий выхода: на новой машине `status(change-id)` однозначно восстанавливает один текущий Cycle и никогда не выбирает старый Record из истории.

### Этап 3. Слой изменения конкретного репозитория

1. Заменить `load` на `implement`; переиспользовать проверку точной Store revision и worktree.
2. Разрешать репозиторий по cwd только однозначно; иначе требовать `--repo`.
3. Сформировать Handoff Envelope и показать Mapping, но не запускать их.
4. Реализовать `record assignment` с проверкой точного чистого коммита, Cycle, Repository Fingerprint и Envelope hash.
5. Реализовать цепочку `supersedes` без выбора по времени.

Тесты: frontend/backend, `store+code`, dirty result, недоступный SHA, чужой Cycle/repository, неверный Envelope hash, поздний старый Receipt, цикл в `supersedes`, потеря локального state.

Критерий выхода: каждый дочерний Assignment получает один текущий точный Result Receipt; в операциях не нужно вводить `cycle_id` или Baseline.

### Этап 4. Сводная проверка в слое общего изменения

1. Строить Snapshot только при наличии текущих Result Receipt всех Assignment.
2. Материализовать Store на `planning_revision` и каждый code repository на `implementation_revision` в управляемых отсоединённых worktree.
3. Рассчитать Verification Contract Fingerprint с обязательным содержимым entrypoint и `contract_inputs`.
4. `verify` возвращает Snapshot + Handoff Envelope, но не запускает тесты.
5. `record verification` принимает `pass|fail|error|inconclusive` только для текущих `cycle_id`, `snapshot_id` и contract fingerprint.
6. Включить Snapshot и Verification Receipt в `status(change-id)` как данные слоя общего изменения.

Тесты: неполный набор Result Receipt, новый Result Receipt, изменённый entrypoint/input, неверный expected Snapshot, недоступный worktree commit, все четыре outcome, повторная материализация.

Критерий выхода: `verify → внешняя проверка → record verification → status` даёт воспроизводимый результат общего Change и не выдаёт его за CI/release approval.

### Этап 5. Миграция, документация и функциональный пилот

1. Добавить preview-only мигратор config; автоматически не мигрировать Baseline/runtime в Cycle/Receipts.
2. `explore` и `change` передать Template/OpenSpec; `load` заменить `implement`. До удаления они возвращают однозначную диагностику с новой командой; скрытой совместимости нет.
3. Переписать README и reference по фактическому CLI; оставить архив явно ненормативным.
4. Провести один реальный Change через Store + frontend + backend с перезапуском между шагами.
5. Провести негативный пилот: чужой Cycle, dirty commit, новый Cycle после Result Receipt, изменённый verification contract, потеря state, переписанная Git history.

Критерий выхода: из холодного checkout один инженер проходит весь сценарий без ручного ввода `cycle_id`, Baseline, Assignment ID и набора коммитов; все отказы объяснимы и не повреждают данные.

### Этап 6. Готовность к распространению

1. Убрать `private: true`, определить npm-имя, лицензию, состав пакета и политику версий.
2. Прогнать пакет из чистого временного каталога на поддерживаемых Node/ОС.
3. Провести матрицу минимум двух Template и одного `adopt` без Template.
4. Опубликовать матрицу совместимости OpenSpec и известные ограничения.
5. Провести второй пилот в другой команде без правок Core.

Критерий выхода: две команды независимо проходят пилот со своими Template/OpenSpec-схемами; пакет воспроизводимо устанавливается. Это не доказывает многопользовательскую координацию; общие Receipts в v1 не реализуются.

## 4. Сквозные проверки

Каждый этап обязан проходить:

- `npm run check` и `git diff --check`;
- unit-тесты схем, канонизации и state transitions;
- интеграционные тесты на реальных временных Git-репозиториях;
- отрицательные тесты без частичной записи;
- одинаковую семантику human/JSON-вывода;
- проверку Windows/macOS/Linux-путей для всего нового файлового контракта;
- проверку, что Core не запускает Template/agent/project commands и не меняет OpenSpec schema;
- `npm pack --dry-run` на этапе 6.

## 5. Риски и точки остановки

| Риск | Защита | Когда остановиться |
|---|---|---|
| Нет публичной OpenSpec-возможности | Матрица совместимости | До изменения концепции; закрытый API не использовать |
| Неоднозначный current Cycle | Чтение одного файла из exact ref tree | При любом поиске «последнего» в истории |
| Core забирает Git workflow | Тесты запрещённых Git-команд | При появлении add/commit/push/merge/rebase/PR в Core |
| Core начинает понимать Template/OpenSpec schema | Непрозрачные Handoff и публичный OpenSpec API | При ветвлении по имени схемы/артефакта |
| Старый runtime ошибочно мигрируется | Не доверять `unpinned`, Baseline и Work Package как Cycle/Receipt | На любой неоднозначности требовать новый `assign`/`record` |
| Локальные Receipts выдаются за общекомандные | Вывод всегда показывает source/locality | Не заявлять командную автоматизацию v1 |

## 6. Полное определение готовности

v1 реализован, только если одновременно:

1. Все операции из раздела 2.1 имеют human/JSON-контракты и негативные тесты.
2. Текущий Cycle однозначно восстанавливается из Git на новой машине.
3. Ни один путь не принимает dirty/unpinned версию как точный результат.
4. Core не изменяет OpenSpec schema, Template-процесс и Git workflow команды.
5. Сводная проверка явно остаётся частью слоя общего изменения, а не четвёртым слоем.
6. Реальный пилот прошёл успешные и отрицательные сценарии.
7. Готовность к распространению подтверждена вторым независимым пилотом и установкой из упакованного артефакта.
