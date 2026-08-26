# OpenSpec Orchestrator: контракт Core и Change Tracking v1

## 0. Статус и назначение документа

Статус: **действующий контракт Core и Change Tracking v1**.

> **Назначение текущей версии.** Этот контракт фиксирует только Core, Plugin Platform
> и Change Tracking: Cycle-контекст и воспроизводимый Snapshot. Он не является полным
> контрактом Project Template, OpenSpec Graph, CodeGraph или agent-facing workflow;
> их собственные контракты находятся в соответствующих Template и Plugin packages.

Этот документ — источник текущего продуктового контракта Core и Change Tracking v1.
Предыдущие модели, планы реализации и audits удалены из рабочего дерева и доступны
только в Git history. Защищённый workplace reference в
[`docs/archive/`](../archive/README.md) не дополняет этот контракт и не имеет
приоритета при конфликте.

Термины определяются этим документом. Store — центральный Git-репозиторий OpenSpec;
Cycle связывает `change_id`, принятую `planning_revision` и состав репозиториев;
Cycle Record представляет Cycle в Git; Assignment — вычисляемая пара
`cycle_id + repository_id`; Result Receipt фиксирует коммит результата; Snapshot —
детерминированный набор таких коммитов; Verification Receipt фиксирует результат
проверки Snapshot.

Core не заморожен. Изменение этого контракта требует явного решения владельца,
обновления относящейся документации и проверки публичного поведения. `BACKLOG.md`
используется как очередь кандидатов, но не является обязательным предварительным
условием каждого изменения.

Документ не дублирует полную грамматику CLI, точные JSON-схемы и алгоритмы
хеширования; их фиксируют исполняемый CLI, код и тесты соответствующего Package.

## 1. Цель v1

Change Tracking v1 отвечает на два вопроса:

1. **Какие репозитории реализуют это изменение и какая версия планирования принята?**
2. **На каких точных коммитах результат каждого репозитория и проверялся ли этот набор целиком?**

Остальные части интегрированного продукта не входят в Change Tracking v1 и не
расширяют его операции автоматически.

### 1.1. Ограничение: один пользователь, одна рабочая копия Store

v1 предполагает **одного пользователя и одну активную рабочую копию Store на машине**. Параллельная работа нескольких пользователей не поддерживается.

Практическое следствие: текущий Cycle определяется по HEAD рабочей копии Store (раздел 3.3), поэтому два человека на разных ветках одного Store могут видеть разные Cycle. Это не баг, а зафиксированное ограничение v1. Cycle Record переносится между машинами через обычный Git; Result Receipts, Snapshots и Verification Receipts остаются локальными на каждой машине и через Git не переносятся. Как в этих рамках распределить роли между людьми — описано в сценарии 5.2.

## 2. Состав v1

### 2.1. Уже реализовано

- `init` — создание нового проекта;
- `connect` — восстановление локального рабочего пространства, клонирование отсутствующих репозиториев.

Требование к ним в рамках v1: привести к конфигурации из раздела 3.2 (строгая версия, реестр репозиториев), если ещё не соответствуют. `connect` не делает pull/rebase/checkout и не переписывает конфигурацию.

### 2.2. Операции v1

Стабильный набор бизнес-операций Cycle — восемь операций: `init`,
`connect`, `repository status`, `assign`, `status`, `record assignment`, `verify`,
`record verification`. Команды `plugin ...` являются lifecycle платформы расширений,
а не новыми операциями Change Tracking.

| Операция | Что делает | Чего не делает в текущей версии |
|---|---|---|
| `init` / `connect` | Как реализовано (раздел 2.1) | — |
| `repository status` | Только чтение: подключён/отсутствует, чистая ли копия, совпадает ли remote и ветка | Не чинит расхождения, не ходит в сеть без явного запроса |
| `assign(change-id, repos)` | Пишет Cycle Record в рабочую копию Store | Не коммитит, не пушит; нет машины состояний активации |
| `status(change-id)` | Читает Cycle Record из HEAD рабочей копии Store, показывает таблицу результатов или стабильный контекст через `--json` | Нет `phase/condition/reason_code`; нет проверки основной ветки |
| `record assignment(change-id, receipt)` | Сохраняет Result Receipt в локальное состояние | Нет `supersedes`; повторная запись заменяет с предупреждением |
| `verify(change-id)` | Проверяет полноту Receipts, вычисляет детерминированный `snapshot_id`, печатает точные коммиты | Не создаёт worktree, не запускает тесты |
| `record verification(change-id, receipt)` | Сохраняет Verification Receipt для последнего Snapshot | Нет отпечатка договора проверки, нет хеша Envelope |

Операции не объединяются: `assign` не планирует содержимое Change, `record assignment`
не выполняет реализацию, а `verify` не запускает проектные проверки.

### 2.3. Неснижаемый минимум проверок

Четыре проверки, ради которых инструмент существует. При нехватке времени режется вывод, подсказки и предупреждения — но не они:

1. `record assignment` отклоняет Receipt, чей `cycle_id` не совпадает с текущим Cycle.
2. `record assignment` отклоняет коммит, не существующий в локальной копии заявленного репозитория.
3. `verify` требует Result Receipt со статусом `completed` для каждого репозитория Cycle.
4. `record verification` отклоняет результат, чьи `cycle_id` или `snapshot_id` не совпадают с последним вычисленным Snapshot.

Текущая версия без этих проверок — обёртка вокруг ручного процесса и не выполняет
свой продуктовый контракт.

### 2.4. Не входит в v1

| Отложенная функция | Evidence для отдельного продуктового решения |
|---|---|
| `plan`, `implement`, Handoff Envelope / Mapping, `contract_inputs` | Записанная боль: «вручную собирать контекст для агента дорого/ошибочно» |
| Активация Cycle Record через основную ветку (`pending → committed_pending → active`) | Появился второй человек, читающий Cycle Record из main |
| `supersedes` для Receipts | Зафиксирован случай перепутанных или пришедших не по порядку результатов |
| Отпечатки репозиториев и договора проверки, хеши Envelope | Зафиксирован случай подмены/расхождения, который они бы поймали |
| Развёртывание точных worktree для реализации и проверки | Боль: «checkout руками на нужные коммиты дорого или ошибочно» |
| Раздельные деревья для `store+code` | Реальный проект со Store, содержащим код |
| `adopt` | Подключение чужого существующего проекта (этап распространения) |
| Вычисляемые `phase / condition / reason_code` | Появилась автоматизация, читающая состояние машинно |
| Результаты проверки `error`, `inconclusive` | Реальный случай, где `pass/fail` недостаточно |
| Токены подтверждения для неинтерактивного режима | Появились скрипты поверх CLI |
| Перенос Receipts между машинами, multi-user | Повторяющаяся боль в командном сценарии 5.2 |

Отсутствие этих функций — не дефект Change Tracking v1. Каждая из них требует
отдельного решения владельца и обновления контракта на основании подтверждённой
потребности.

### 2.5. Plugin Platform

Core владеет только общим lifecycle `plugin register/init/connect/status/sync/disconnect/remove`,
загрузкой Package, разрешением Template requirements, Repository bindings, scoped
context, монтированием команд и безопасным применением объявленных file overlays. Бизнес-
логика Cycle/Receipts/Snapshot находится в bundled Plugin `change-tracking`; CodeGraph
находится в отдельном bundled Plugin `codegraph`. Оба Package поставляются как
dependencies Orchestrator, а внешний Plugin подключается как npm-compatible source.

Plugin является самостоятельным ESM Package с одним entrypoint в `package.json` и
использует только публичный `@openspec-orch/plugin-sdk`. Project Template может
объявить Plugin ID в `requires.plugins`, а Plugin Package может владеть собственным
Plugin Template. Base Template не содержит Plugin assets и не импортирует Package;
Core разрешает ID через Plugin Catalog и применяет оба Template через общий generic
движок. Core не содержит условий по Plugin ID; имена bundled Plugins и список
разрешённых root-команд известны только distribution composition root. Порядок загрузки
Plugins не специфицирован, и Plugin не должен зависеть от загрузки другого Plugin.

Project skill может быть единым entrypoint общей операции и условно передавать
plugin-specific часть установленному skill по известному Plugin ID. Это интеграционный
handoff, а не владение asset: Base сохраняет полноценный режим без Plugin, не копирует
его правила и блокируется, если конфигурация объявляет Plugin подключённым, но его
Template установлен неполно.

Добавление следующего Plugin не требует изменения Core. Публичный контракт автора,
scoped facades и contract test kit описаны в
[`packages/plugin-sdk/README.md`](../../packages/plugin-sdk/README.md).

## 3. Модель данных

Основные классы данных разделены по владельцу и сроку жизни:

| Данные | Хранение | Владелец |
|---|---|---|
| `openspec-orch.yaml` | Git, Store | Пользователь |
| `.openspec-orch/changes/<change-key>.json` (Cycle Records) | Git, Store | Core |
| `.openspec-orch/state.json` (локальный workspace) | только локальная машина, в `.gitignore` | Core |
| `.openspec-orch/plugins/change-tracking/state.json` (Receipts, Snapshots) | только локальная машина, в `.gitignore` | Change Tracking Plugin через Core storage |
| `.openspec-orch/cache/plugin-runtimes/<plugin-id>/` | только локальная машина, в `.gitignore` | Plugin manager |
| `openspec/…` | Git, Store | OpenSpec и Plugin владеют содержимым; Core может материализовать только явно объявленный Template asset, не интерпретируя его |

Receipts и Snapshots **никогда** не попадают в Git в текущей версии. Cycle Record
**никогда** не хранится только в локальном Plugin state.

### 3.1. Версионирование

Файловые контракты содержат явные версии:

1. **`version`, `contract_version` или `storage_version`** в каждом файловом формате.
   Неподдерживаемая версия при чтении — ошибка, а не тихая интерпретация.
   `openspec-orch.yaml` поддерживается только в текущем формате v1; скрытой миграции нет.
2. **Версия алгоритма внутри вычисления `snapshot_id`**: версия входит в хешируемые данные, чтобы бета могла расширить проекцию (например, отпечатком договора проверки) без коллизий со старыми идентификаторами.

Будущее расширение добавляет поля через инкремент версии соответствующего формата.

### 3.2. `openspec-orch.yaml`

```yaml
version: 1
strict: true
agents: [qwen]
plugins:
  - id: dependency-audit
    source: "@company/openspec-plugin-dependency-audit@1.2.0"
    required: true

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: []
  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
    plugins: [dependency-audit]
```

Правила:

- обязательное поле `version`; неподдерживаемая версия — ошибка;
- в v1 неизвестные поля вне `version`, `strict`, `agents`, `plugins`, `repositories` — ошибка; секции `agent`, `handoffs` и старый `extensions` не допускаются;
- `agents` содержит уникальные Agent ID, зарегистрированные успешным `init`;
- каждый элемент `plugins` содержит Plugin ID и точную package identity в `source`;
  `required: true` фиксирует зависимость активного Project Template и запрещает удаление Plugin;
- ровно один репозиторий с ролью `store`;
- без секретов и локальных абсолютных путей;
- каждый `repositories[].plugins` ссылается только на ID из верхнеуровневого `plugins`;
- перечитывается при каждой операции.

Plugin Package не является частью Base Template, но может содержать собственный каталог
`template/`. Project Template объявляет обязательные расширения через
`requires.plugins`; успешный `openspec-orch init` разрешает их через каталог, вызывает
обычный Plugin lifecycle и сохраняет точную package identity с `required: true`.
`plugin init` загружает bundled Package
из установленного дистрибутива либо materialize внешний npm-compatible source и его
production dependencies в локальный cache Store, после чего сохраняет ID и точную
package identity в проекте. `plugin connect` выполняет setup в точном Repository и
только после успеха сохраняет связь. Core импортирует обязательный ESM entrypoint,
объявленный в `package.json`, без shell и без отдельного descriptor.
`plugin register` создаёт самостоятельный исходный Package с `package.json`,
entrypoint и одним из профилей `commands`, `repository`, `native`; optional
`--template` добавляет каркас Plugin Template. Команда не меняет Store или
Plugin-specific код в Core.
Необязательные Agent hooks позволяют Package установить и удалить собственные MCP и
инструкции для каждого зарегистрированного агента; Core не знает их provider formats.

### 3.3. Cycle Record и текущий Cycle

Путь: `.openspec-orch/changes/<base64url-change-id>.json`. `change-id` кодируется из
UTF-8 в base64url без padding; содержимое записи сохраняет исходный `change_id` и
проверяется при чтении.

```json
{
  "contract_version": 1,
  "cycle_id": "cycle-<uuid или hash>",
  "change_id": "checkout-flow",
  "planning_revision": "a1b2c3...",
  "repositories": ["frontend", "backend"],
  "created_at": "2026-08-16T10:00:00Z"
}
```

Правила:

- `cycle_id` — настоящий уникальный ID, генерируется при каждом `assign`, даже с упрощённой активацией v1;
- `planning_revision` — точный чистый коммит Store на момент `assign`; `assign` требует чистое рабочее дерево Store без незавершённой операции Git;
- `repositories` — список `repository_id` из реестра; неизвестный ID — ошибка;
- `created_at` — диагностика, в идентичность не входит;
- Cycle Record не содержит задач, целей, критериев приёмки и порядка реализации.

**Определение текущего Cycle в v1.** Текущим для `change-id` считается Cycle из записи, найденной по нормативному пути в **HEAD текущей рабочей копии Store**. Термин «текущий Cycle» везде в этом документе означает именно это; полноценной машины состояний (`pending → committed_pending → active`) и чтения точного дерева основной ветки в v1 сознательно нет — это упрощение и источник ограничения из раздела 1.1.

Пользователь сам коммитит файл обычным процессом Git; `status` предупреждает, если файл существует в рабочем дереве, но не закоммичен (в этом случае `record assignment` и `verify` останавливаются).

Если evidence подтвердит необходимость multi-user, определение текущего Cycle можно
заменить чтением нормативного пути из дерева основной ветки отдельным принятым
Change; формат Cycle Record менять для него не потребуется.

### 3.4. Result Receipt

Хранится в payload `.openspec-orch/plugins/change-tracking/state.json`:

```json
{
  "contract_version": 1,
  "receipt_id": "result-<uuid>",
  "cycle_id": "cycle-...",
  "repository_id": "frontend",
  "implementation_revision": "f111...",
  "status": "completed",
  "source": "agent | human | ci",
  "note": "необязательный текст",
  "created_at": "..."
}
```

Проверки при `record assignment` (все — ошибки, не предупреждения; пункты 1–2 входят в неснижаемый минимум раздела 2.3):

1. `cycle_id` совпадает с текущим Cycle;
2. коммит `implementation_revision` существует в локальной копии указанного репозитория;
3. `repository_id` входит в состав Cycle;
4. `status` ∈ `completed | failed | blocked`.

Дополнительно, если репозиторий определяется текущим каталогом: предупреждение при несовпадении HEAD рабочей копии с заявленным коммитом (не ошибка — в v1 пользователь может записывать результат из другого каталога).

Незакоммиченные изменения, stash и diff версией реализации не являются.

**Замена результата.** Новый Receipt для той же пары `cycle_id + repository_id`
заменяет предыдущий; предыдущий сохраняется в истории Change Tracking state;
пользователь получает предупреждение «результат заменён». Поля `supersedes` в v1
нет; строгая цепочка может быть добавлена только отдельным принятым Change с
подтверждённой потребностью.

### 3.5. Snapshot

Вычисляется `verify`, хранится в Change Tracking state:

```json
{
  "contract_version": 1,
  "snapshot_id": "snap-<детерминированный hash>",
  "cycle_id": "cycle-...",
  "implementations": { "frontend": "f111...", "backend": "b222..." },
  "created_at": "..."
}
```

`snapshot_id = hash(версия алгоритма, contract_version, cycle_id, канонически отсортированные пары repository_id + implementation_revision)`.

Это правило — **не упрощение, а ядро ценности**, и оно фиксируется в контракте: время, пути, имя машины в идентичность не входят. Повторный `verify` с теми же входами возвращает тот же `snapshot_id`.

**Упрощение v1 — без развёртывания.** `verify` не создаёт worktree. Он печатает таблицу «репозиторий → точный коммит» и инструкцию: проверяющий сам делает checkout. Ответственность Core — только детерминированная идентичность набора версий.

### 3.6. Verification Receipt

```json
{
  "contract_version": 1,
  "receipt_id": "verification-<uuid>",
  "cycle_id": "cycle-...",
  "snapshot_id": "snap-...",
  "result": "pass | fail",
  "source": "human | agent | ci",
  "note": "...",
  "created_at": "..."
}
```

Проверки (неснижаемый минимум, п. 4 раздела 2.3): `cycle_id` и `snapshot_id` совпадают с последним вычисленным Snapshot текущего Cycle. Несовпадение — ошибка.

Результатов два: `pass | fail`. Замена — как у Result Receipt: с предупреждением, история сохраняется.

### 3.7. Локальное состояние

- Core хранит только workspace в `.openspec-orch/state.json`;
- Change Tracking хранит Receipts и Snapshots в собственном
  `.openspec-orch/plugins/change-tracking/state.json` внутри версионированного Core
  storage envelope;
- payload Change Tracking версионирован (`contract_version`);
- пишется атомарно (запись во временный файл + rename);
- валидируется при чтении; повреждённый файл — ошибка с предложением пересоздать, без тихой перезаписи;
- Plugin state содержит Result Receipts (текущие + история замен), Snapshots и Verification Receipts;
- **не** содержит Cycle Records и не служит источником истины для Cycle;
- полная потеря Change Tracking state не ломает Cycle: `status` восстанавливает Cycle
  из Git и честно показывает Receipts как `missing`, а не «предположительно пройдено».

## 4. Поведение команд

### 4.1. `assign(change-id, repository IDs)`

1. Перечитать конфигурацию, проверить реестр.
2. Потребовать чистое рабочее дерево Store (иначе ошибка: `planning_revision` должна быть точным коммитом).
3. Показать предварительный просмотр: `change_id`, `planning_revision`, состав репозиториев, путь будущего файла, явное «Core не создаст коммит».
4. После подтверждения атомарно записать Cycle Record.
5. Вывести: «запись создана, закоммитьте её обычным процессом Git; до коммита `record` и `verify` недоступны».

Повторный `assign` с теми же `planning_revision` и составом — идемпотентно возвращает текущий Cycle. С другими — предупреждение «будет создан новый Cycle, прежние Receipts перестанут быть текущими», подтверждение, новый `cycle_id`. Receipts между циклами не переносятся.

### 4.2. `status(change-id)`

Только чтение. Показывает:

- текущий Cycle: `cycle_id` (сокращённо), `planning_revision`, закоммичен ли Cycle Record;
- по каждому репозиторию: Receipt `completed` на коммите X / `failed` / `blocked` / нет результата / коммит недоступен;
- последний Snapshot и Verification Receipt, если есть, с пометкой `current: true/false`;
- одну строку «следующее действие» (закоммитить Cycle Record / записать результаты для N репозиториев / вызвать verify / записать verification / готово).

Расхождение HEAD рабочей копии кода с коммитом Receipt — информационное сообщение,
не ошибка: сохранённый точный SHA не становится ложным от движения ветки.

### 4.3. `record assignment`, `verify`, `record verification`

По разделам 3.4–3.6. Общие правила:

- каждая операция получает явный `change-id`; скрытого «активного изменения» нет;
- репозиторий определяется текущим каталогом, при неоднозначности — явный `repository-id`;
- Receipt передаётся флагами CLI (`--commit`, `--status`, `--source`, `--note`); файл/stdin в v1 не входят.

### 4.4. Инварианты для всех команд

Действуют следующие инварианты:

1. Core не выполняет `git add/commit/push/merge/rebase/checkout` и не создаёт PR — никогда, ни в одной команде (`connect` может только клонировать отсутствующее).
2. Бизнес-операции Change Tracking не запускают реализацию, проектные тесты или код
   Template. Core запускает только фиксированные Git/OpenSpec/npm и Plugin lifecycle
   процессы, явно описанные контрактами `init`, `connect` и `plugin`; произвольный
   shell через Change Tracking отсутствует.
3. Core не читает внутреннюю структуру файлов OpenSpec и не ветвится по имени схемы.
4. Любая ошибка — безопасный отказ без частично записанного состояния, которое выдаётся за успех.
5. Все пути проверяются на выход за корень проекта.
6. Вывод показывает идентичности и точные коммиты; источник Receipt всегда виден.

## 5. Целевые сценарии

Сценарии показывают, как текущая версия используется в работе. Оба обязаны
выполняться только реализованными операциями; требуемые ручные действия указаны явно.

### 5.1. Один инженер

Change `checkout-flow`, репозитории `frontend` и `backend`, всё на одной машине.

1. **Подключение.** `connect` — рабочие копии Store, `frontend` и `backend` на месте. `repository status` — всё `connected`, копии чистые.
2. **Планирование.** Инженер готовит Change обычным процессом OpenSpec, коммитит состояние планирования в Store. Оркестратор в этом шаге не участвует.
3. **Принятие.** `assign(checkout-flow, frontend backend)` — предпросмотр показывает `planning_revision` (текущий коммит Store) и состав; после подтверждения появляется `.openspec-orch/changes/checkout-flow.json`. Инженер коммитит файл. `status(checkout-flow)` показывает Cycle и «следующее действие: записать результаты для 2 репозиториев».
4. **Реализация frontend.** Инженер (сам или через своего агента, вне оркестратора) вносит изменения в `frontend`, прогоняет проектные проверки, коммитит. Из каталога `frontend`: `record assignment(checkout-flow) --commit f111 --status completed --source agent`. Core проверяет `cycle_id` и существование коммита.
5. **Реализация backend.** То же для `backend`, коммит `b222`. `status` показывает оба `completed`, следующее действие — `verify`.
6. **Проверка.** `verify(checkout-flow)` — Core печатает `snapshot_id` и таблицу `frontend → f111, backend → b222`. Инженер делает checkout на эти коммиты, выполняет проектные проверки. `record verification(checkout-flow) --result pass --source human`.
7. **Итог.** `status(checkout-flow)` — Cycle, оба результата, Snapshot, `pass`, «готово».
8. **Возврат через несколько дней.** Тот же `status(checkout-flow)` восстанавливает всю картину; `cycle_id` и коммиты вручную не вводятся.
9. **Потеря Change Tracking state.** Cycle восстанавливается из Git; Receipts
   показываются как `missing` — инженер повторно записывает результаты, если может их подтвердить.

### 5.2. Команда: аналитик, фронтенд, бэкенд, тестировщик

Роли — организационные; в Core нет учётных записей и прав, все различают работу по `repository_id`. Один человек может совмещать несколько ролей. Cycle Record переносится между машинами через Git; **Receipts — нет** (ограничение 1.1), и сценарий это честно учитывает.

| Роль | Операции | Что передаёт дальше |
|---|---|---|
| Аналитик | процесс OpenSpec, `assign`, коммит и push Cycle Record | Cycle Record в Store (через Git) |
| Фронтенд / бэкенд | `connect`, `status`, реализация вне Core, `record assignment` на своей машине | точный SHA коммита реализации (в PR, чате или тикете — обычным процессом команды) |
| Тестировщик | `status`, `record assignment` (внесение полученных SHA), `verify`, проектные проверки, `record verification` | результат `pass/fail` с `snapshot_id` |

Последовательность:

1. Аналитик готовит Change, коммитит планирование, вызывает `assign(checkout-flow, frontend backend)`, коммитит и пушит Cycle Record.
2. Разработчики на своих машинах: `git pull` в Store, `connect` при необходимости, `status(checkout-flow)` — Cycle виден из Git, `cycle_id` никто не пересылает вручную.
3. Каждый реализует свой репозиторий, коммитит и пушит, записывает Result Receipt локально (для собственного учёта) и сообщает точный SHA обычным каналом команды.
4. Тестировщик на своей машине: `git pull`/`fetch` в Store и репозиториях кода, затем вносит полученные SHA как Receipts: `record assignment(checkout-flow, frontend) --commit f111 --status completed --source human --note "SHA от фронтенд-разработчика, PR #42"`. Проверка существования коммита ловит опечатки в SHA.
5. Тестировщик вызывает `verify` — получает `snapshot_id` и точный набор версий, делает checkout, проверяет, записывает `record verification`.
6. Любой участник видит общий результат `status(checkout-flow)` на машине тестировщика; на других машинах `status` честно показывает только Cycle и локально записанные Receipts.

Ограничения сценария (ожидаемые, не баги):

- шаг 4 — ручной перенос SHA; если он окажется частой болью, это записанный триггер для беты «перенос Receipts через Git» из backlog 2.4;
- все участники должны иметь Cycle Record в HEAD своей рабочей копии Store (обычный `git pull`); работа на разных ветках Store даёт разный «текущий Cycle» — см. 1.1;
- `source: human` в Receipt тестировщика честно отражает, что результат внесён по сообщению разработчика, а не получен автоматически.

## 6. Ошибки и предупреждения

- **Ошибка** — операция не выполняется; подтверждение не обходит ошибку. Минимальный набор кодов: `CONFIG_INVALID`, `CYCLE_NOT_FOUND`, `CYCLE_NOT_COMMITTED`, `CYCLE_MISMATCH`, `REPO_UNKNOWN`, `COMMIT_NOT_FOUND`, `SNAPSHOT_MISMATCH`, `STORE_DIRTY`, `STATE_CORRUPTED`.
- **Предупреждение** — интерактивный вопрос «продолжить?»; по умолчанию отмена. Примеры: замена Receipt, несовпадение HEAD с заявленным коммитом, создание нового Cycle поверх существующего.

Коды — стабильные строки, чтобы будущий машинный контракт мог использовать их как
`reason_code` без переименования. Токены подтверждения и `needs_confirmation` для
неинтерактивного режима не реализуются.
