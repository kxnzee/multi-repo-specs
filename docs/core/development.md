# Разработка Orchestrator

## Подготовка checkout

Нужны Git, Node.js >=22.16.0 и npm. Минимальную версию фиксируют `package.json` и CI;
при использовании nvm выполните `nvm install` и `nvm use`. На Windows выберите
ту же версию в своём менеджере Node. `.npmrc` отклоняет несовместимый Node при
установке зависимостей, `.gitattributes` задаёт окончания строк для всех ОС.

```bash
git clone <orchestrator-repository-url>
cd multi-repo-specs
npm ci
npm run check:environment
node src/bin/openspec-orch.js --help
```

Все команды разработки запускаются из корня. `npm ci` устанавливает workspace
packages и точную dev-версию OpenSpec 1.11.0 из lockfile. Глобальный OpenSpec,
`npm link`, Docker и аккаунты Claude/Qwen/GigaCode для тестов не нужны. CLI
работает непосредственно из JavaScript ES modules, отдельной сборки нет.

`check:environment` проверяет Git, локальный OpenSpec, поддерживаемый Node и
загрузку CLI/workspaces. Он не создаёт Store, не устанавливает gateway и не
меняет глобальную конфигурацию пользователя. Для работы с реальным Store вне
checkout следуйте [инструкции установки](../user/installation-and-updates.md).

## Проверки и быстрый цикл

| Задача | Команда |
|---|---|
| Диагностика зависимостей и CLI | `npm run check:environment` |
| Статические правила и import boundaries | `npm run lint` |
| Все unit, integration и structural tests | `npm run test:code` |
| Один файл | `npm run test:code -- src/packages/core/test/package-supply.test.js` |
| Один сценарий | `npm run test:code -- --test-name-pattern="immutable Git revision" src/packages/core/test/package-supply.test.js` |
| Диагностика, lint и все tests | `npm run check` |
| Coverage нативного Node test runner | `npm run test:coverage` |
| Локальная упаковка tarballs и проверка public entrypoints | `npm run test:pack` |
| Установка tarballs в чистый consumer с внешними npm-зависимостями | `npm run test:pack:consumer` |
| Полная локальная проверка, включая tarballs | `npm run check:all` |
| Проверка пробелов в diff | `git diff --check` |

Начните с тестов изменяемого слоя. Перед завершением code/environment changes
выполните `npm run check` и `git diff --check`. Изменение зависимостей,
entrypoints, exports, workspace/package composition или CI дополнительно требует
`test:pack`. Для release validation или controlled CI дополнительно запустите
`test:pack:consumer`. Для правок только документации проверьте затронутые команды
и ссылки.

Root-команды проверок подключают `scripts/verification/environment.js`: он ставит
локальный `node_modules/.bin` первым в PATH и задаёт `OPENSPEC_TELEMETRY=0`,
`DO_NOT_TRACK=1`, `OPENSPEC_NO_UPDATE_CHECK=1`. Это работает одинаково в POSIX
shell и PowerShell, не требует ручного `export` и не влияет на обычный запуск
пользовательского CLI. Прямой `node --test` обходит эту подготовку; используйте
root npm-команды, в том числе для тестов отдельных workspaces.

Тесты выполняются последовательно с timeout 180 секунд на файл. При зависании сначала
проверьте оставшийся процесс, незакрытый MCP client, HTTP server или открытый
handle. Не маскируйте проблему через `--test-force-exit`. Таймаут теста не гарантирует завершения процесса с handles, оставшимися
после успешных assertions; общий лимит CI ограничивает и такой случай.
Увеличение concurrency требует проверки изоляции fixtures и окружения.

Добавляйте тест для конкретного наблюдаемого сбоя. Успешный путь установки и
удаления внешнего Plugin проверяет `src/packages/core/test/plugin-init-e2e.test.js`,
Extension — `src/packages/core/test/extension-cli-e2e.test.js`. Проверки нижних слоёв
нужны для самостоятельных контрактов и отказов: rollback, сохранности конфигурации,
валидации до изменения файлов и восстановления runtime. Не дублируйте успешный
путь проверками одной лишь передачи аргументов моку.

Structural tests проверяют загружаемые manifests, ссылки, схемы и согласованность
поставляемых payloads. Точные формулировки инструкций проверяются при ревью;
совпадение фразы не доказывает поведение агента. Вспомогательные модули размещайте
в `test-support/` или `fixtures/` вне каталогов `test`: Node иначе считает их
отдельными успешными тестами даже без сценариев.

`npm ci` и `test:pack:consumer` требуют доступа к npm registry; Git-source проверки
используют локальные временные Git repositories. `test:pack` собирает все publishable
tarballs в отдельном временном каталоге и проверяет, что в каждом есть `package.json`,
public exports и CLI entrypoints. Для него не нужны registry, workspace symlinks или
пользовательский npm cache.

`test:pack:consumer` отдельно устанавливает эти tarballs в пустой consumer с чистым
npm cache, загружает public exports и сверяет версию public CLI. Это проверка
поставки вместе с независимыми npm-зависимостями, поэтому задержка registry не
означает ошибку собранного артефакта. По умолчанию установка ограничена десятью
минутами; для медленного контура передайте
`PACKED_CONSUMER_INSTALL_TIMEOUT_MS=<миллисекунды>`. Поведение внешних provider CLI
эта проверка не эмулирует. CI запускает проверки на Linux, macOS и Windows с общим
лимитом job 15 минут.

## Карта кода

| Путь | Назначение |
|---|---|
| `src/bin/` | Distribution entrypoints и композиция CLI/MCP |
| `src/packages/core/` | Generic domain, use cases и adapters |
| `src/packages/plugin-sdk/` | Public Plugin API и test kit |
| `src/packages/extension-sdk/` | Public Extension API и test kit |
| `src/packages/mcp/` | Governed stdio MCP |
| `plugins/` | First-party Plugin packages |
| `src/agents/` | Provider definitions и adapters |
| `extensions/` | Standalone Agent payloads |
| `templates/` | Copy-only Project Template catalog |
| `scripts/verification/` | Проверка окружения и package smoke |
| `test/` | Integration и structural tests |

Тесты packages и Plugins находятся в их `test/`. Правила работы агента над
реализацией находятся в корневом [AGENTS.md](../../AGENTS.md). Payloads в
`templates/` и `extensions/` поставляются пользователям и не управляют этим
checkout. Нормативные Changes и Master Specs находятся в отдельном Store;
их расположение нужно получить из задачи или project configuration.
Maintenance самого репозитория не требует создания фиктивного Store.

## Архитектурные правила

- Core остаётся generic и не знает ID или domain grammar Plugins.
- Plugins импортируют публичный Plugin SDK; Extension contract принадлежит Extension SDK.
- Project-specific context и schemas принадлежат Template.
- Agent workflow artifacts принадлежат Extensions, provider CLI — adapter.
- Observable behavior получает regression test; stdout содержит результат,
  stderr — progress и диагностику.
- Paths, cwd и lifecycle mutations остаются scoped и fail-closed.

## Добавление Plugin, Agent, Extension и Template

1. Создайте Plugin package через `plugin register` или вручную.
2. Реализуйте contributions через публичный SDK и фактическую проверку `status`.
3. Добавьте package tests и SDK contract test.
4. Для bundled Plugin добавьте dependency и запись в root
   `openspecOrchestrator.bundledPlugins`.
5. Проверьте `npm run check:all`.

Новый Agent добавляется в `src/agents/<id>/`; provider-specific CLI остаётся в adapter.
Bundled Extension содержит descriptor и manifests поддерживаемых Agents.
Plugin-owned Extension возвращается через SDK с точным target.

Bundled Template находится в `templates/<id>/`; directory name совпадает с
`template.yaml.id`. Если workflow требует Extension, descriptor объявляет её
через `requires.extensions`. Developer environment не должен устанавливать
эти payloads в пользовательский профиль ради запуска тестов.

## Диагностика и review

- Ошибка импорта workspace или неверный OpenSpec: проверьте корень checkout,
  версию Node и выполните `npm ci`, затем `npm run check:environment`.
- `EBUSY` на Windows: сначала закройте child process/client, затем удаляйте его
  рабочую папку. Cleanup должен выполняться и при ошибке assertion.
- После смены ветки с изменённым lockfile повторите `npm ci`; не редактируйте lock
  вручную. При обновлении зависимости коммитьте manifest и lock вместе.
- Перед PR проверьте границы Core/SDK/Plugin, validation до mutation, отсутствие
  перезаписи user-owned files, согласованность public contract, tests и docs.

Автотесты используют реальный OpenSpec и поддельный Qwen adapter. Они не
подтверждают реальные provider accounts, Git hosting, native CodeGraph или
произвольную OpenSpec version. Изменение такой границы требует отдельного smoke
с явным указанием проверенной среды. Коммит, публикация ветки и PR выполняются
по задаче пользователя; merge и deployment остаются отдельными действиями.

## Проверка агентских workflow helpers

`test/agent-workflow-helpers.test.js` проверяет извлечение одной задачи из общего
плана, отказ без перезаписи brief при неоднозначности, изоляцию progress по плану
и ветке и сохранение исходного worktree при closeout. Fixtures используют временные
Git repositories. Helpers принадлежат Superpowers Extension; локальные изменения
vendored skills перечислены в `extensions/superpowers/NOTICE.md`.

Для multi-repo плана передавайте `--repo <repository-id>` в `task-brief`. Ledger
использует каталог из `sdd-workspace <plan-file>`; общий старый `progress.md` не
переносится автоматически. Без Bash доступны эквивалентные команды
`node <skill-directory>/scripts/task-context.cjs brief ...` и `workspace ...`.
Запускайте helpers из назначенного Code Repository, передавая точный путь плана.

`test/agent-audit-helpers.test.js` исполняет дополнительные regression cases
для shipped Bash helpers, review packages, visual events, renderer и bootstrap.
Для shell cases нужен Bash (на Windows — Git Bash из Git for Windows).

`find-polluter.sh` требует явный runner после `--`:
`find-polluter.sh <absent-path> <test-pattern> -- <runner> [args...]`.
Каждый выбранный путь теста добавляется последним отдельным аргументом без shell
интерпретации. Runner должен выполнять только этот тест; для другого интерфейса
используйте wrapper. Прежний вызов без runner отклоняется до запуска тестов.

### Снимок для ревью без commit

Helper Superpowers поддерживает два режима (пути задаются из Code Repository):

```bash
bash <skill-directory>/scripts/review-package BASE HEAD OUTFILE
bash <skill-directory>/scripts/review-package BASE --worktree OUTFILE -- src/file.js test/file.test.js
```

Во втором режиме укажите все принадлежащие задаче пути, включая новые файлы,
удаления и обе стороны переименований. Пути трактуются буквально; каталоги
включают всё их содержимое, кроме игнорируемых новых файлов. Не включайте чужую
работу. OUTFILE должен находиться вне checkout или в Git-ignored scratch.
Снимок содержит committed изменения BASE → HEAD и выбранные изменения worktree
поверх HEAD. Helper пишет Git objects через временный индекс, не меняет рабочие
файлы, пользовательский индекс, HEAD или ветку и не создаёт commit.

Пакет содержит checkout, полный HEAD и SHA дерева снимка. Исполнитель связывает
команды и результаты тестов с этим деревом; координатор сверяет идентичность
отчёта и пакета перед ревью. Снимки до и после тестов должны совпадать; после
изменения кода нужны актуальные проверки. Изменения вне выбранных путей могут
влиять на тесты: такой результат нельзя выдавать за проверку точного снимка.
На время подготовки снимка и передачи на ревью изменения приостанавливают.
Отсутствие пакета незакоммиченной работы не допускает подмены через BASE..HEAD.

## Поставка и совместимость

Корневой пакет `openspec-orchestrator` содержит точки входа CLI, определения агентов,
встроенные расширения и шаблоны. Core, MCP и встроенные плагины входят как точные
внутренние зависимости. Orchestrator запускается на рабочей машине или в CI и не
становится зависимостью среды выполнения репозиториев кода. Принятую версию выбирает
Store.

При поставке через рабочую копию Git используются `npm ci` и `npm link`; её
идентичность задают неизменяемые тег и коммит. Для публикуемого пакета корневой пакет
и публикуемые рабочие пространства размещаются в корпоративном реестре npm. Store
хранит точную корневую зависимость и файл блокировки; внутренние пакеты отдельно не
выбираются.

| Контракт | Как обновлять |
|---|---|
| CLI/Core API | По release notes; breaking change требует новой major policy |
| `openspec-orch.yaml` | Отдельным Store PR |
| Template assets | Store PR, а не повторным `init` |
| Project schemas | Старые ID и DAG сохраняются для активных Changes; новый DAG получает новый ID |
| Bundled Plugins | Вместе с distribution |
| External Plugin | Явным обновлением точного source |
| Agent gateway и Extensions | Переустановкой native payload и восстановлением подключений |
| Plugin data | Миграцией владельца Plugin |

Release notes фиксируют tag, commit, package version, поддерживаемые Node/OpenSpec/Agents,
класс миграции, изменённые контракты, проверки и rollback. Неизвестные config и storage
versions отклоняются fail-closed. `init` создаёт Store и один раз применяет Template;
переносимые миграции проходят review в ветке Store, machine-local - после merge на
каждой машине. Code Repositories меняются только по отдельному принятому Change.

Перед выпуском выполните:

```bash
npm run check:all
git diff --check
```

`check:all` включает `test:pack`: локальную проверку tarballs. Сетевая
`test:pack:consumer` запускается отдельно для release validation или controlled CI.
`npm pack --dry-run` проверяет только состав root tarball и не заменяет ни одну из
них. Новый supported baseline требует isolated smoke с заявленной версией OpenSpec
и каждым поддерживаемым Agent provider.
