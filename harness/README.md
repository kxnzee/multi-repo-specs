# OpenSpec Orchestrator

`harness/` — автономная техническая реализация пользовательских команд OpenSpec Orchestrator. Код из этой директории не является нормативным описанием процесса: правила процесса находятся в `docs/`, а рабочее состояние проекта — в корневом `openspec/` и каталоге выбранного agent adapter.

## Первый запуск

Требуются Node.js `20+` и OpenSpec `1.7.0`; поддерживаются macOS, Linux и Windows. Эта версия закреплена в `openspec-orch.yaml`, а другая версия блокирует команды OpenSpec Orchestrator. Назначение всех полей описано в [справочнике `openspec-orch.yaml`](../docs/reference/openspec-orch-yaml.md). Из корня репозитория выполните:

```bash
cd harness
npm install
npm link
cd ..
openspec-orch --help
```

После успешной проверки интерфейс командной строки можно вызывать из корня и других каталогов:

```bash
openspec-orch init --help
```

Регистрация выполняется один раз для каждой активной версии Node.js. После переключения версии через NVM повторите `npm link` из директории `harness/`.

## Создание центрального проекта

`openspec-orch init` выполняется один раз из чистого корня подготовленного центрального Git-репозитория с `origin` и текущей основной веткой:

```bash
openspec-orch init --store payments-specs --agent qwen \
  --repo ui=https://example.test/ui.git#main \
  --repo api=https://example.test/api.git#main
```

Команда проверяет совместимость OpenSpec, устанавливает официальный expanded agent pack, создаёт Store через `openspec store setup` и поверх результата применяет Project Template. Набор workflows передаётся профилю `custom` через временную изолированную конфигурацию, поэтому глобальный профиль OpenSpec пользователя не изменяется. `--agent` обязателен и выбирает mapping из Template. Без `--template` используется встроенный Template с mappings `qwen` и `gigacode`; локальный Template полностью заменяет встроенный:

```bash
openspec-orch init --store payments-specs --agent team-agent --template ../team-template
```

Template определяет копируемые project files, перенос официального agent pack и необязательные handoffs Core-команд. Его mapping сохраняется в `openspec-orch.yaml`, поэтому после успешного `init` исходный Template не нужен. Файлы Template имеют приоритет над файлами, созданными текущим OpenSpec init. Существовавший до запуска идентичный файл пропускается, а отличающийся останавливает preflight без merge или overwrite.

При повторном запуске Store metadata считается только признаком начатой инициализации: `openspec-orch init` проверяет согласованность Core config, минимальный OpenSpec root и agent mapping. Полное состояние не изменяется, а частичное возвращает `needs_recovery` с перечнем причин. Автоматического ремонта пока нет.

Если этот же путь остался зарегистрирован в локальном registry OpenSpec после предыдущего теста, `openspec-orch init` останавливается до изменения файлов и показывает существующий Store ID. Для чистого первого запуска выполните показанную команду `openspec store unregister <store-id>`, затем повторите `openspec-orch init`. `unregister` забывает только локальную регистрацию и не удаляет файлы репозитория; `openspec store remove` для этого сценария не используется.

Встроенный Template содержит `CODEOWNERS`; если команда его использует, Technical Owner заменяет placeholder-владельцев реальными account handles. Пользовательский Template может не содержать этот файл вообще.

Запуск без регистрации в `PATH`:

```bash
node harness/bin/openspec-orch.js init --store payments-specs --agent qwen
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
openspec-orch connect
```

Если имя каталога Store отличается от `store-id` или Store расположен отдельно, задайте workspace один раз:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

`openspec-orch connect` сохраняет канонический путь как локальную Git-настройку `openspec-orch.workspace` центрального Store. Настройка не коммитится и используется последующими `openspec-orch connect` и `openspec-orch explore`; явный `--workspace` заменяет сохранённое значение.

Команда валидирует Core config, Store metadata и repositories, передаёт Store identity официальным `store register`, `store doctor`, `doctor --store` и `context --store`, структурно проверяет их JSON, затем загружает все записи `role: code` из `openspec-orch.yaml` в `<workspace>/src/<repository-id>`. Process assets выбранного Template ей не нужны: конкретный handoff проверяется только при вызове зависящей от него команды. Существующие checkout не обновляются и не перезаписываются: проверяются только их `origin`, ветка и чистота.

Если в Code Repository отсутствует единственный допустимый `openspec/config.yaml`, команда создаёт pointer `store: <store-id>` и возвращает `needs_setup_pr`. Она не делает commit, push или PR. После принятия setup PR обновите checkout и повторите `openspec-orch connect`.

`openspec-orch` не повторяет внутренние правила OpenSpec: ошибки официальных команд возвращаются пользователю напрямую. Адаптер проверяет только границу ответа — отсутствие `severity: error` и ожидаемые Store ID, путь и `source`. `connect_status: ready` означает, что адаптер завершил свою часть без `needs_setup_pr`; проектный шаг всё равно требует принятого initialization PR. Незакоммиченный pointer, созданный предыдущим запуском, остаётся штатным `needs_setup_pr`, а не делает повторный запуск невозможным.

## Explore запроса

Перед запуском вручную обновите через `git pull --ff-only` основную ветку Store и Code Repositories, которые собираетесь выбрать. Если область исследования неизвестна, обновите все Code Repositories из `openspec-orch.yaml`. `openspec-orch connect` не обновляет существующие checkout, а `openspec-orch explore` выполняет только `fetch` и проверку; отдельной команды массового обновления нет. Затем запустите из Spec Root, его вложенного каталога или подключённого Code Repository:

```bash
openspec-orch explore --ticket PAY-412
```

Для нестандартной раскладки можно передать `--workspace <path>`. Команда через официальный Store API проверяет OpenSpec root, оригинальный agent action `/opsx-explore`, `openspec-orch.yaml`, активные и архивные Changes, а также наличие всех checkout, подготовленных `openspec-orch connect`. Затем она интерактивно предлагает выбрать Code Repositories и запрашивает одно непустое исходное намерение. Это цель исследования, а не готовая проблема или ожидаемый результат: их агент уточняет во время Explore. Пустой подтверждённый выбор репозиториев запускает Explore только по нормативному контексту и Master Specs центрального репозитория с `role: store`.

Explore не клонирует репозитории и не создаёт ticket-specific workspace. Для Store и выбранных постоянных checkout команда проверяет чистоту, `default_branch`, выполняет только `git fetch` и требует совпадения `HEAD` с `origin/<default_branch>`. Для каждого выбранного Code Repository дополнительно проверяется точный config-only pointer и разрешение того же Store через `doctor/context` с `source: declared`. Файловые права не меняются.

После успешной проверки CLI формирует готовый prompt со штатным `/opsx-explore`, runtime-параметрами и точным путём из `agent.handoffs.explore`. В prompt входят ticket, исходное намерение, Store ID, workspace, точные пути и ревизии. Постоянные границы, порядок исследования и формат результата находятся в handoff-файле Template, а не в JavaScript. Во встроенном Template это `.sdd/instructions/explore.md`; пользовательский Template может выбрать другой путь или не объявлять Explore вообще.

После проверки CLI печатает готовый prompt. Откройте новую сессию выбранного агента из корня Store и вставьте prompt целиком первым сообщением. Не отправляйте описание задачи отдельным сообщением до `/opsx-explore`.

```text
/opsx-explore PAY-412. Перед исследованием прочитай и выполни проектный контракт "/workspace/payments-specs/.sdd/instructions/explore.md". ...
```

`openspec-orch explore` не изменяет содержимое `opsx-explore.md`: файл принадлежит OpenSpec и обновляется вместе с его версией. Handoff-файл содержит дополнительные проектные правила и не регистрируется как slash-команда. Отдельной `/openspec-orch-explore` нет. Если Template не объявил `agent.handoffs.explore` или соответствующий файл отсутствует, ошибка возвращается только при вызове `openspec-orch explore`; `connect` и остальные независимые команды продолжают работать.

`openspec-orch explore` требует интерактивный TTY для выбора репозиториев и ввода намерения, но самостоятельно агента не запускает.

## Создание Change и Proposal

После принятого Explore продолжайте в той же агентской сессии:

```text
/sdd-change PAY-412 payment-status
```

Команда требует структурированный итог текущего `/opsx-explore`, вызывает детерминированный CLI:

```bash
openspec-orch change --ticket PAY-412 --name payment-status --store payments-specs
```

CLI разрешает только центральный Store, проверяет совпадение явного `--store` с текущим checkout, его регистрацию и identity, активные и архивные Changes, чистую актуальную основную ветку, отсутствие локальной и remote planning-ветки, затем создаёт `feature/pay-412-payment-status` и вызывает официальный `openspec new change`. При повторном запуске допускаются изменения только внутри того же Change; существующий Proposal продолжается без перезаписи. Ветка без Change, другая schema, commit или изменения вне Change возвращают `needs_recovery`.

После JSON-результата agent command получает официальные `openspec instructions proposal`, создаёт только `proposal.md` из подтверждённого Explore и завершает шаг лишь после явного подтверждения Change Owner. Delta Specs, `design.md`, `tasks.md`, commit, push и PR на этом этапе не создаются. `/opsx-propose` не вызывается, встроенные команды и skills OpenSpec не изменяются.

Во встроенном Template правила `openspec/config.yaml` определяют, когда основному planning-agent нужен read-only Repository Context Pass. Этот Template устанавливает базовый `repository-context-pass` и optional специализации в provider-specific каталог `agents/`; основной агент подбирает профиль по `description` и запускает его штатным инструментом runtime. Core не знает список subagents и не требует их при `init` или `connect`: пользовательский Template может изменить или полностью убрать этот механизм. Человеческое объяснение встроенного варианта и пример расширения находятся в `docs/reference/subagents.md` и агенту не передаются.

## Planning PR и Spec Baseline

После завершения Proposal, Delta Specs, Design и Tasks шаг 04 не вызывает отдельную команду OpenSpec Orchestrator. Change Owner выполняет штатные `openspec status`, `openspec show` и строгий `openspec validate`, синхронизирует `feature/<change-id>` через rebase и открывает единый Planning PR средствами Git-провайдера. Полный пользовательский процесс описан в [`docs/steps/04.md`](../docs/steps/04.md).

Содержательные замечания Planning PR передаются агенту точным списком через официальный `/opsx-update <change-id>`. Штатная команда изменяет существующие planning-артефакты и подтверждает каждую запись, а компактный routing override в project instructions отвечает только за завершённый `/opsx-continue`: вместо Apply или Archive он направляет на шаг 04. Commit, push, закрытие threads, approvals и merge остаются действиями Change Owner и владельцев в Git-провайдере. Каждый Work Package остаётся стандартным checkbox `tasks.md` с явной целью; машинный ID берётся только из `tasks[].id` структурированного `openspec instructions apply` на принятом Baseline. Стандартный `openspec validate` не проверяет проектную цель Work Package, а отдельный валидатор OpenSpec Orchestrator не вводится.

Spec Baseline равен полной Git SHA, принятой в основной ветке Store после merge. Harness не создаёт `openspec-orch review`, `openspec-orch baseline`, Git tag или state-файл. После merge Change Owner вручную создаёт в исходной Story по одной parameter-only implementation subtask на каждый окончательно затронутый `repository-id`; отдельная QA-subtask пока не является обязательным гейтом.

## Подготовка реализации

Из корня Code Repository перенесите параметры принятой implementation subtask в команду:

```bash
openspec-orch load \
  --store payments-specs \
  --repo payments-api \
  --change pay-412-payment-status \
  --baseline 0123456789abcdef0123456789abcdef01234567 \
  --work-package 1 \
  --work-package 2
```

Команда принимает Store ID, repository-id, Change, Baseline и Work Package ID непосредственно из актуальной implementation subtask. Она сверяет Store с project pointer, repository-id — с cwd, `origin` и `openspec-orch.yaml`, проверяет существование точной Store commit, открывает её в отдельном detached worktree, вызывает штатные OpenSpec validation и apply instructions, показывает descriptions, создаёт или возобновляет локальную `feature/<change-id>` и записывает минимальный `context.json` без descriptions.

`openspec-orch load` не читает tracker, не доказывает историю Planning PR или amendment, не сравнивает параметры с прежним runtime, не копирует Tasks, не меняет код или planning-артефакты и не запускает Apply. Каждый запуск полностью определяется текущими параметрами subtask. После `implementation_ready` начните новую агентскую сессию из того же Code Repository и передайте ей готовое первое сообщение `next_action`: оно сначала указывает на `agent.instructions_file`, затем на файл из `agent.handoffs.apply` внутри точного runtime Store и содержит те же Store, repository, Change, Baseline и Work Packages. Во встроенном Template этим файлом является `sdd-apply.md`. Копировать slash-команду в Code Repository не требуется. Подробности находятся в [`docs/steps/05.md`](../docs/steps/05.md).

## Реализация

Шаг 06 не добавляет исполняемую команду harness. Агент сначала читает provider-файл, затем Apply handoff выбранного Template из immutable Store worktree, проверяет точное совпадение параметров с `context.json`, повторяет штатные `openspec validate` и `openspec instructions apply`, затем изменяет только текущий Code Repository и выполняет его локальные проверки.

Инструкция поддерживает обычное продолжение с тем же runtime и не создаёт собственный progress-state. Provider-файл из runtime Store обязателен и уже загружен через `next_action`; отдельный файл технических инструкций в текущем Code Repository остаётся опциональным, а при его отсутствии агент адресно читает необходимые код и тесты. Commit, rebase, push, PR и tracker выполняются только по отдельному явному поручению пользователя. Центральный `tasks.md` не меняется, implementation PR не сливается, а успешная реализация передаётся в Composite Verification шага 07. Полный контракт находится в [`docs/steps/06.md`](../docs/steps/06.md).

## Границы

- `bin/` — минимальные точки входа командной строки.
- `config/index.js` — строгий разбор Store identity и реестра `openspec-orch.yaml`.
- `connect/index.js` — техническая логика `openspec-orch connect`.
- `change/index.js` — создание и безопасное продолжение Change шага 02.
- `explore/index.js` — read-only-проверки уже подключённого workspace шага 01.
- `init/` — техническая логика `openspec-orch init` и Core-owned шаблон `openspec-orch.yaml`.
- `load/index.js` — подготовка implementation-ветки и runtime точного Spec Baseline.
- `shared/` — единый безопасный запуск внешних команд.
- `template/` — Core-owned parser и безопасный copy planner Project Template; применение plan выполняет только `init`.
- `templates/base/` — встроенный базовый Project Template: skeleton, agent commands, инструкции и subagents без исполняемой логики Core.
- `test/` — тесты технической обвязки, не входящие в публикуемый пакет.

Встроенный Template явно отображает `assets/gitignore.template` в `.gitignore`; общего правила удаления суффиксов в Core нет.

`init/index.js` выполняет короткую Git-проверку, вызывает официальные Store/init API OpenSpec и раскладывает базовый Template. `connect/index.js` вызывает официальные register/doctor, создаёт workspace, загружает Code Repositories и проверяет project pointer. Внутренние правила OpenSpec адаптер не дублирует. Стандартная схема `spec-driven` и её шаблоны берутся из установленного OpenSpec; текущий базовый workflow находится в `templates/base/` и устанавливается поверх результата OpenSpec.

## Разработка

Из корня репозитория:

```bash
npm --prefix harness run check
npm --prefix harness test
node harness/bin/openspec-orch.js --help
```
