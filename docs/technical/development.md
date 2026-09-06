# Разработка Orchestrator

## Подготовка checkout

Нужны Git, Node.js >=22.16.0 и npm. `.nvmrc` фиксирует минимальную версию из CI;
при использовании nvm выполните `nvm install` и `nvm use`. На Windows выберите
ту же версию в своём менеджере Node. `.npmrc` отклоняет несовместимый Node при
установке зависимостей, `.gitattributes` задаёт окончания строк для всех ОС.

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git
cd multi-repo-specs
npm ci
npm run check:environment
node bin/openspec-orch.js --help
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
| Все unit, integration, distribution и structural tests | `npm run test:code` |
| Один файл | `npm run test:code -- packages/core/test/package-supply.test.js` |
| Один сценарий | `npm run test:code -- --test-name-pattern="immutable Git revision" packages/core/test/package-supply.test.js` |
| Диагностика, lint и все tests | `npm run check` |
| Runtime coverage с общими и пофайловыми порогами | `npm run test:coverage` |
| Уязвимости всех npm dependencies, включая dev | `npm run check:security` |
| Установка publishable tarballs в чистый consumer | `npm run test:pack` |
| Полная проверка, включая packed consumer | `npm run check:all` |
| Проверка пробелов в diff | `git diff --check` |

Начните с тестов изменяемого слоя. Перед завершением code/environment changes
выполните `npm run check` и `git diff --check`. Изменение зависимостей,
entrypoints, exports, workspace/package composition или CI дополнительно требует
`test:pack`. Для правок только документации проверьте затронутые команды и ссылки.

Root-команды проверок подключают `scripts/verification-environment.js`: он ставит
локальный `node_modules/.bin` первым в PATH и задаёт `OPENSPEC_TELEMETRY=0`,
`DO_NOT_TRACK=1`, `OPENSPEC_NO_UPDATE_CHECK=1`. Это работает одинаково в POSIX
shell и PowerShell, не требует ручного `export` и не влияет на обычный запуск
пользовательского CLI. Прямой `node --test` обходит эту подготовку; используйте
root npm-команды, в том числе для тестов отдельных workspaces.

Тесты выполняются последовательно с timeout 180 секунд. При зависании сначала
проверьте оставшийся процесс, незакрытый MCP client, HTTP server или открытый
handle. Не маскируйте проблему через `--test-force-exit` или пропуск distribution
smoke. Таймаут теста не гарантирует завершения процесса с handles, оставшимися
после успешных assertions; общий лимит CI ограничивает и такой случай.
Увеличение concurrency требует проверки изоляции fixtures и окружения.

`npm ci` и `test:pack` требуют доступа к npm registry; Git-source проверки
используют локальные временные Git repositories. `test:pack` также запускает public CLI/MCP scenarios против установленных tarballs:
первый init, повторный connect, Doctor, Plugins, Graph и Change Tracking.
Harness и MCP client находятся в checkout; проверяемые CLI/MCP entrypoints и их
dependencies — в чистом consumer. Qwen остаётся заглушкой.
`test:pack` намеренно использует
отдельный consumer и пустой npm cache, чтобы проверить поставляемые пакеты без
помощи workspace symlinks. Локальный npm cache проекта эта проверка не удаляет.
Каждый npm subprocess в packed smoke ограничен двумя минутами. CI запускает
проверки на Linux, macOS и Windows с общим лимитом job 15 минут.

## Бесплатные CI-проверки

`.github/workflows/check.yml` сохраняет проверки на трёх ОС и добавляет отдельный
Linux job `coverage`. Native Node discovery продолжает находить все тесты.
В coverage входят загруженные runtime-файлы из `agents/`, `bin/`, `packages/`
и `plugins/`, без `test/`, `fixtures/` и проверочных scripts. Общие минимумы:
91% строк, 81% ветвей, 94% функций. Это покрытие исполняемого кода, не процент
всех файлов репозитория: Node не добавляет в отчёт незагруженные модули.

`scripts/coverage-gate.js` дополнительно запрещает падение branch coverage ниже
пофайловых минимумов для native Extensions, initialization, package supply,
Plugin storage, MCP server/runtime и Change Tracking attempts. Отсутствующий
критичный файл тоже проваливает проверку. Точные пороги заданы в
`CRITICAL_BRANCH_FLOORS`; результат виден в job summary. Для нового критичного
модуля добавляйте тесты и отдельный порог, а не только общий процент.

`.github/workflows/security.yml` запускает:

- `dependency-audit`: `npm audit` всего lockfile; high/critical блокируют job.
- `dependency-review`: в PR блокирует новые high/critical уязвимые зависимости.
- `codeql (javascript-typescript)` и `codeql (actions)`: статический анализ
  runtime и workflows с `security-extended`. `scripts/check-sarif.js` блокирует
  security severity >=7 и findings уровня error; отсутствующий/некорректный
  SARIF или неуспешный анализ не считаются успешной проверкой.

Security workflow выполняется в PR, при push в `master` и раз в неделю.
Расписание начинает работать только после попадания workflow в default branch.
`.github/dependabot.yml` задаёт еженедельные PR для npm и GitHub Actions;
автослияния нет. Actions закреплены полными commit SHA, checkout не сохраняет
credentials, write-доступ есть только у CodeQL к security events. Запуска
PR-кода через `pull_request_target` нет.

Конфигурация рассчитана на **публичный GitHub repository**: используются
стандартные hosted runners, бесплатные CodeQL/Dependabot и npm audit.
Платные внешние сервисы, provider API, larger runners, загрузка Actions artifacts
и Actions cache не используются; отчёты остаются в logs, job summary и Code
Scanning. При переводе репозитория в private доступность и лимиты нужно
пересмотреть до запуска. Эти проверки не заменяют реальный Agent smoke и не
гарантируют отсутствия уязвимостей.

Для поэтапного внедрения workflows также запускаются в PR к
`fix/pilot-readiness-audit`. Существующие три обязательных check на `master`
сохраняются. После доставки новых workflows в `master` и первого зелёного
запуска добавьте `coverage`, `dependency-audit`, `dependency-review`,
`codeql (javascript-typescript)` и `codeql (actions)` в required status checks
branch protection. Не требуйте новые имена до доставки workflow: старые PR,
не содержащие этих jobs, иначе останутся заблокированы ожидаемыми проверками.

## Карта кода

| Путь | Назначение |
|---|---|
| `bin/` | Distribution entrypoints и композиция CLI/MCP |
| `packages/core/` | Generic domain, use cases и adapters |
| `packages/plugin-sdk/` | Public Plugin API и test kit |
| `packages/extension-sdk/` | Public Extension API и test kit |
| `packages/mcp/` | Governed stdio MCP |
| `plugins/` | First-party Plugin packages |
| `agents/` | Provider definitions и adapters |
| `extensions/` | Standalone Agent payloads |
| `templates/` | Copy-only Project Template catalog |
| `scripts/` | Проверка окружения и package smoke |
| `test/` | Distribution и structural tests |

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

Новый Agent добавляется в `agents/<id>/`; provider-specific CLI остаётся в adapter.
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
