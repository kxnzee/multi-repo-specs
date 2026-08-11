# Техническая обвязка SDD

`harness/` — автономная техническая реализация пользовательских команд SDD. Код из этой директории не является нормативным описанием процесса: правила процесса находятся в `docs/`, а рабочее состояние проекта — в корневом `openspec/` и каталоге выбранного agent adapter.

## Первый запуск

Требуются Node.js `20+` и OpenSpec `1.7.0`; поддерживаются macOS, Linux и Windows. Эта версия закреплена в `sdd.yaml`, а другая версия блокирует команды SDD. Из корня репозитория выполните:

```bash
cd harness
npm install
npm link
cd ..
sdd --help
```

После успешной проверки интерфейс командной строки можно вызывать из корня и других каталогов:

```bash
sdd init --help
```

Регистрация выполняется один раз для каждой активной версии Node.js. После переключения версии через NVM повторите `npm link` из директории `harness/`.

## Создание центрального проекта

`sdd init` выполняется один раз из чистого корня подготовленного центрального Git-репозитория с `origin` и текущей основной веткой:

```bash
sdd init --store payments-specs --agent qwen \
  --repo ui=https://example.test/ui.git#main \
  --repo api=https://example.test/api.git#main
```

Команда проверяет совместимость OpenSpec, создаёт Store через официальный `openspec store setup`, устанавливает официальный expanded agent pack и раскладывает SDD skeleton. Набор workflows передаётся профилю `custom` через временную изолированную конфигурацию, поэтому глобальный профиль OpenSpec пользователя не изменяется. `--agent` обязателен и принимает `qwen` или `gigacode`. GigaCode использует официальный OpenSpec adapter `qwen`, но готовый pack переносится в `.gigacode/`, а инструкция записывается в `GIGACODE.md`; фактическое соответствие сохраняется в `sdd.yaml`. Уже существующий официальный `.qwen/` также переносится целиком и после успешного `init` не остаётся.

Существующий OpenSpec root без Store metadata принимается без удаления specs, Changes и собственных настроек config: адаптер добавляет только обязательные настройки SDD. Обычные `.gitignore` и `CODEOWNERS` также сохраняются и дополняются. При повторном запуске Store metadata считается только признаком начатой инициализации: `sdd init` проверяет согласованность конфигурации, OpenSpec root, проектный skeleton и обязательные команды агента. Полное состояние не изменяется, а частичное возвращает `needs_recovery` с перечнем причин. Автоматического ремонта пока нет.

Если этот же путь остался зарегистрирован в локальном registry OpenSpec после предыдущего теста, `sdd init` останавливается до изменения файлов и показывает существующий Store ID. Для чистого первого запуска выполните показанную команду `openspec store unregister <store-id> --json`, затем повторите `sdd init`. `unregister` забывает только локальную регистрацию и не удаляет файлы репозитория; `openspec store remove` для этого сценария не используется.

В рамках этой однократной инициализации Technical Owner заменяет созданные placeholder-владельцы в `CODEOWNERS` реальными account handles и активирует правила для нормативного контекста. Настроенный CODEOWNERS входит в initialization PR центрального репозитория; участники команды не настраивают его повторно при `sdd connect`.

Запуск без регистрации в `PATH`:

```bash
node harness/bin/sdd.js init --store payments-specs --agent qwen
```

## Подключение рабочей машины

Стандартная раскладка содержит один центральный Store рядом с каталогом Code Repositories:

```text
<workspace>/
├── <store-id>/
│   └── openspec/
└── src/
```

Имя каталога Store должно совпадать с `store-id` из `.openspec-store/store.yaml`. После клонирования выполните из корня Store:

```bash
sdd connect
```

Если имя каталога Store отличается от `store-id` или Store расположен отдельно, задайте workspace один раз:

```bash
sdd connect --workspace /absolute/path/to/workspace
```

`sdd connect` сохраняет канонический путь как локальную Git-настройку `sdd.workspace` центрального Store. Настройка не коммитится и используется последующими `sdd connect` и `sdd explore`; явный `--workspace` заменяет сохранённое значение.

Команда проверяет наличие обязательных agent actions `/opsx-explore`, `/opsx-continue`, `/opsx-update`, `/sdd-context`, `/sdd-change` и runtime-инструкции `sdd-apply.md`, передаёт Store identity официальным `store register`, `store doctor`, `doctor --store` и `context --store`, структурно проверяет их JSON, затем загружает все записи `role: code` из `sdd.yaml` в `<workspace>/src/<repository-id>`. Существующие checkout не обновляются и не перезаписываются: проверяются только их `origin`, ветка и чистота.

Если в Code Repository отсутствует единственный допустимый `openspec/config.yaml`, команда создаёт pointer `store: <store-id>` и возвращает `needs_setup_pr`. Она не делает commit, push или PR. После принятия setup PR обновите checkout и повторите `sdd connect`.

`sdd` не повторяет внутренние правила OpenSpec: ошибки официальных команд возвращаются пользователю напрямую. Адаптер проверяет только границу ответа — отсутствие `severity: error` и ожидаемые Store ID, путь и `source`. `connect_status: ready` означает, что адаптер завершил свою часть без `needs_setup_pr`; проектный шаг всё равно требует принятого initialization PR. Незакоммиченный pointer, созданный предыдущим запуском, остаётся штатным `needs_setup_pr`, а не делает повторный запуск невозможным.

## Общий контекст проекта

При первичной инициализации проекта после настройки CODEOWNERS и успешного `sdd connect` Technical Owner запускает `/sdd-context` в интерактивной сессии выбранного агента из корня центрального Store. Без действующих правил CODEOWNERS команда не изменяет контекст. Она читает `_raw/`, нормативный context pack, Master Specs, принятые ADR и служебную конфигурацию только этого репозитория, а изменяет исключительно `openspec/context/`.

При подключении уже инициализированного проекта участник команды выполняет только `sdd connect`: принятые CODEOWNERS и context pack приходят из центрального репозитория и не настраиваются заново.

После выбора нормативной роли содержательные вопросы задаются по одному и открытым текстом. Агент не должен предлагать придуманные варианты предметных ответов; пользователь может ответить «не знаю», «пропустить» или «позже».

`/sdd-context` не обращается к URL и checkout Code Repositories, не читает `<workspace>/src/`, не клонирует временные копии и не проверяет реализацию. Store registry и multi-repo workspace уже проверены `sdd connect`; работа с кодом начинается только после выбора области через `sdd explore` и передаётся оригинальному `/opsx-explore`.

## Explore запроса

Перед запуском вручную обновите через `git pull --ff-only` основную ветку Store и Code Repositories, которые собираетесь выбрать. Если область исследования неизвестна, обновите все Code Repositories из `sdd.yaml`. `sdd connect` не обновляет существующие checkout, а `sdd explore` выполняет только `fetch` и проверку; отдельной команды массового обновления нет. Затем запустите из Spec Root, его вложенного каталога или подключённого Code Repository:

```bash
sdd explore --ticket PAY-412
```

Для нестандартной раскладки можно передать `--workspace <path>`. Команда через официальный Store API проверяет OpenSpec root, оригинальный agent action `/opsx-explore`, `sdd.yaml`, активные и архивные Changes, а также наличие всех checkout, подготовленных `sdd connect`. Затем она интерактивно предлагает выбрать Code Repositories и запрашивает одно непустое исходное намерение. Это цель исследования, а не готовая проблема или ожидаемый результат: их агент уточняет во время Explore. Пустой подтверждённый выбор репозиториев запускает Explore только по нормативному контексту и Master Specs центрального репозитория с `role: store`.

Explore не клонирует репозитории и не создаёт ticket-specific workspace. Для Store и выбранных постоянных checkout команда проверяет чистоту, `default_branch`, выполняет только `git fetch` и требует совпадения `HEAD` с `origin/<default_branch>`. Для каждого выбранного Code Repository дополнительно проверяется точный config-only pointer и разрешение того же Store через `doctor/context` с `source: declared`. Файловые права не меняются.

После успешной проверки CLI печатает готовую строку для выбранного агента. Она вызывает оригинальный action OpenSpec и передаёт ему ticket, исходное намерение, Store ID, workspace, точные пути и ревизии, границы «только чтение» и обязательные разделы результата. Workspace задаёт multi-repo-территорию, но читать разрешено только явно перечисленные Spec Root и выбранные checkout; родительские каталоги, remotes и невыбранные репозитории запрещены.

Откройте новую сессию агента из корня Store и вставьте всю строку первым сообщением. Не отправляйте описание задачи отдельным сообщением до `/opsx-explore`. Строка начинается с:

```text
/opsx-explore PAY-412. Это Explore шага 01 SDD. Исходное намерение: "Понять, как показывать пользователю актуальный статус платежа в UI на основе данных API". ...
```

`sdd explore` не изменяет содержимое `opsx-explore.md`: файл принадлежит OpenSpec. Для Qwen отсутствующий action восстанавливается через `openspec update --force`. Для GigaCode прямой update не используется, пока официальный adapter создаёт `.qwen/`; совместимый `.gigacode/` pack обновляется вместе с SDD adapter. `sdd explore` требует TTY; флага для неинтерактивного ввода в первой реализации нет. Переданная дополнительная инструкция запрещает создавать Change, SDD-метадату, ветку, коммит или PR и читать Jira по API.

Если в будущем аргумента оригинального action станет недостаточно, отдельная ревизия процесса может добавить `/sdd-explore`. Она должна жить в пространстве имён `sdd-*` и не перезаписывать `opsx-*`; текущая реализация такой команды не создаёт.

## Создание Change и Proposal

После принятого Explore продолжайте в той же агентской сессии:

```text
/sdd-change PAY-412 payment-status
```

Команда требует структурированный итог текущего `/opsx-explore`, вызывает детерминированный CLI:

```bash
sdd change --ticket PAY-412 --name payment-status --store payments-specs
```

CLI разрешает только центральный Store, проверяет совпадение явного `--store` с текущим checkout, его регистрацию и identity, активные и архивные Changes, чистую актуальную основную ветку, отсутствие локальной и remote planning-ветки, затем создаёт `feature/pay-412-payment-status` и вызывает официальный `openspec new change`. При повторном запуске допускаются изменения только внутри того же Change; существующий Proposal продолжается без перезаписи. Ветка без Change, другая schema, commit или изменения вне Change возвращают `needs_recovery`.

После JSON-результата agent command получает официальные `openspec instructions proposal`, создаёт только `proposal.md` из подтверждённого Explore и завершает шаг лишь после явного подтверждения Change Owner. Delta Specs, `design.md`, `tasks.md`, commit, push и PR на этом этапе не создаются. `/opsx-propose` не вызывается, встроенные команды и skills OpenSpec не изменяются.

## Planning PR и Spec Baseline

После завершения Proposal, Delta Specs, Design и Tasks шаг 04 не вызывает отдельную команду SDD. Change Owner выполняет штатные `openspec status`, `openspec show` и строгий `openspec validate`, синхронизирует `feature/<change-id>` через rebase и открывает единый Planning PR средствами Git-провайдера. Полный пользовательский процесс описан в [`docs/steps/04.md`](../docs/steps/04.md).

Содержательные замечания Planning PR передаются агенту точным списком через официальный `/opsx-update <change-id>`. Project instructions ограничивают исправление существующими planning-артефактами текущего Change и не позволяют команде перейти к Apply или Archive. Commit, push, закрытие threads, approvals и merge остаются действиями Change Owner и владельцев в Git-провайдере. Каждый Work Package остаётся стандартным checkbox `tasks.md` с явной целью; машинный ID берётся только из `tasks[].id` структурированного `openspec instructions apply` на принятом Baseline. Стандартный `openspec validate` не проверяет проектную цель Work Package, а отдельный SDD-валидатор не вводится.

Spec Baseline равен полной Git SHA, принятой в основной ветке Store после merge. Harness не создаёт `sdd review`, `sdd baseline`, Git tag или state-файл. После merge Change Owner вручную создаёт в исходной Story по одной parameter-only implementation subtask на каждый окончательно затронутый `repository-id`; отдельная QA-subtask пока не является обязательным гейтом.

## Подготовка реализации

Из корня Code Repository перенесите параметры принятой implementation subtask в команду:

```bash
sdd load \
  --store payments-specs \
  --repo payments-api \
  --change pay-412-payment-status \
  --baseline 0123456789abcdef0123456789abcdef01234567 \
  --work-package 1 \
  --work-package 2
```

Команда принимает Store ID, repository-id, Change, Baseline и Work Package ID непосредственно из актуальной implementation subtask. Она сверяет Store с project pointer, repository-id — с cwd, `origin` и `sdd.yaml`, проверяет существование точной Store commit, открывает её в отдельном detached worktree, вызывает штатные OpenSpec validation и apply instructions, показывает descriptions, создаёт или возобновляет локальную `feature/<change-id>` и записывает минимальный `context.json` без descriptions.

`sdd load` не читает tracker, не доказывает историю Planning PR или amendment, не сравнивает параметры с прежним runtime, не копирует Tasks, не меняет код или planning-артефакты и не запускает Apply. Каждый запуск полностью определяется текущими параметрами subtask. После `implementation_ready` начните новую агентскую сессию из того же Code Repository и передайте ей готовое первое сообщение `next_action`: оно указывает на `sdd-apply.md` внутри точного runtime Store и содержит те же Store, repository, Change, Baseline и Work Packages. Копировать slash-команду в Code Repository не требуется. Подробности находятся в [`docs/steps/05.md`](../docs/steps/05.md).

## Реализация

Шаг 06 не добавляет исполняемую команду harness. Агент читает `sdd-apply.md` из immutable Store worktree, проверяет точное совпадение параметров с `context.json`, повторяет штатные `openspec validate` и `openspec instructions apply`, затем изменяет только текущий Code Repository и выполняет его локальные проверки.

Инструкция поддерживает обычное продолжение с тем же runtime, не создаёт собственный progress-state и не блокируется отсутствием Repository Knowledge Pack: в этом случае агент адресно читает необходимые код и тесты. Commit, rebase, push, PR и tracker выполняются только по отдельному явному поручению пользователя. Центральный `tasks.md` не меняется, implementation PR не сливается, а успешная реализация передаётся в Composite Verification шага 07. Полный контракт находится в [`docs/steps/06.md`](../docs/steps/06.md).

## Границы

- `bin/` — минимальные точки входа командной строки.
- `config/index.js` — строгий разбор Store identity и реестра `sdd.yaml`.
- `connect/index.js` — техническая логика `sdd connect`.
- `change/index.js` — создание и безопасное продолжение Change шага 02.
- `explore/index.js` — read-only-проверки уже подключённого workspace шага 01.
- `init/index.js` — техническая логика `sdd init`.
- `load/index.js` — подготовка implementation-ветки и runtime точного Spec Baseline.
- `shared/` — единый безопасный запуск внешних команд.
- `init/skeleton/` — декларативный версионируемый каркас шага 00 без исполняемой логики.
- `test/` — тесты технической обвязки, не входящие в публикуемый пакет.

Суффикс `.template` у файла каркаса удаляется при установке. Например, `.gitignore.template` становится `.gitignore`; это позволяет npm включить файл в пакет.

`init/index.js` выполняет короткую Git-проверку, вызывает официальные Store/init API OpenSpec и раскладывает каркас. `connect/index.js` вызывает официальные register/doctor, создаёт workspace, загружает Code Repositories и проверяет project pointer. Внутренние правила OpenSpec адаптер не дублирует. Стандартная схема `spec-driven` и её шаблоны берутся из установленного OpenSpec; SDD задаёт только проектный контекст, дополнительные правила и команды агента в `init/skeleton/`.

## Разработка

Из корня репозитория:

```bash
npm --prefix harness run check
npm --prefix harness test
node harness/bin/sdd.js --help
```
