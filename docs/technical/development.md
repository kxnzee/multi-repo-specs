# Разработка Orchestrator Core

Этот документ описывает границы исходного кода и минимальные проверки для
разработчиков Orchestrator. Пользователям CLI он не нужен.

## Границы кода

- `bin/openspec-orch.js` — composition root публичного CLI;
- `packages/core/` — доменная модель, Core use cases, CLI и generic Plugin host;
- `packages/plugin-sdk/` — единственный API, доступный Plugin packages;
- `plugins/change-tracking/` — команды и домен истории изменений;
- `plugins/codegraph/` — CodeGraph lifecycle, launcher, MCP и Agent instructions;
- `plugins/openspec-graph/` — Store-only граф Store, Repository, Master Spec, Change и Delta Spec;
- `templates/base/` — Project Template, используемый только при `init`;
- `packages/*/test/` и `plugins/*/test/` — code tests, принадлежащие своим packages;
- `test/` — только интеграционные проверки собранного distribution;
- `checks/template/` — отдельный structural contract Template;
- `checks/agent-artifacts/` — отдельные проверки формата skills,
  commands и subagents.

Non-code checks обнаруживаются по соглашению во всём monorepo: положите
`*.test.js` в `checks/<suite>/` корня, `packages/<name>/` или `plugins/<name>/`.
Добавлять package-specific npm script не нужно; общий runner собирает suite сам.

Пользовательская поверхность — CLI `openspec-orch`. Для авторов Plugin публичным
контрактом является только `@openspec-orch/plugin-sdk`; импорт Core internals запрещён.

Корневой `package.json` перечисляет Core и first-party Plugins как обычные npm
dependencies. Поэтому установка Orchestrator автоматически устанавливает SDK, все
Plugin package и их собственные runtime dependencies. Корневой tarball содержит
только CLI composition root и Project Template; исходники workspace-пакетов в нём не
дублируются.

`openspec-orch plugin register <plugin-id> [path]` создаёт весь authoring contract
в отдельном npm package. Профиль `commands` оставляет только `registerCommands`,
`repository` добавляет guarded `connect/status`, `native` — package-owned launcher
adapter; `--template` создаёт каркас Plugin Template. Добавление нового Plugin не
требует изменения Core. Его dependencies и platform-specific artifacts принадлежат
самому Plugin package.

Project Template объявляет обязательные расширения только по Plugin ID в
`requires.plugins`. Distribution Plugin Catalog разрешает ID в package source, а
обычный Plugin Application lifecycle сохраняет точную identity с `required: true`.
Core не знает конкретных Plugin ID. Удаление required Plugin запрещено до применения
Template без этой зависимости; сам Package автоматически не удаляется.

Plugin Package может содержать собственный `template/` с тем же copy contract, что и
Base Template. Plugin descriptor объявляет только `agents.<id>.copy` и не повторяет
Base agent adapter metadata. Если Plugin не объявляет Agent contribution, Core
автоматически применяет Plugin Template через общий `ProjectTemplateService` при
`plugin init`. Код Plugin для этого не нужен.

Необязательная Agent contribution остаётся расширенной lifecycle-границей. Plugin
может явно вернуть imperative `install/remove` для семантического merge либо
декларативный `copy: [{from, to}]`; явная contribution заменяет автоматическое
применение `template/`. Файлы, добавленные Plugin Template или декларативным copy,
не удаляются автоматически. `plugin remove` удаляет declaration и runtime, затем
показывает Store-relative paths для ручной очистки.

`packages/core/internal/settings.js` содержит централизованные изменяемые defaults: command timeout,
project strict default, каталог Code Repositories, Plugin concurrency и параметры
OpenSpec init. Их изменение считается изменением project policy и может влиять на
создаваемый config, layout или эксплуатационное поведение.
Статические версии схем, regex и служебные пути собраны отдельно в
`packages/core/internal/constants.js`; YAML-поля и CLI grammar остаются частью своих
контрактов.

## Добавление агента

Поддержка нового агента добавляется без изменения Core:

- добавьте mapping в `templates/base/template.yaml`;
- копируйте совместимые канонические файлы напрямую, а несовместимые адаптируйте в
  `templates/base/adapters/<agent-id>/`;
- обновите только `docs/user/supported-agents.md` и универсальные тесты Template,
  не добавляя отдельный реестр или тестовые ветвления по agent id;
- проверьте `openspec-orch init` и обнаружение instructions, project skill и
  subagent в нативном runtime. Если runtime недоступен, не объявляйте поддержку
  проверенной.

## Проверки

```bash
npm test                         # code tests всех workspaces и test/*.test.js
npm run check:template           # отдельно Project Template
npm run check:agent-artifacts    # отдельно Template и Plugin-owned agent artifacts
npm run check
npm pack --dry-run
npm pack --workspaces --dry-run
git diff --check
node bin/openspec-orch.js --help
```

Документация не является входом test suite и не проверяется текстовыми assertions,
списком файлов или link checker. Каждый Package запускает собственные tests через свой
`package.json`; корневой `npm test --workspaces --if-present` обнаруживает новые
Package автоматически. Plugin code tests используют только публичный
`@openspec-orch/plugin-sdk` и не импортируют Core. Integration tests обнаруживаются по
`test/*.test.js`, а Template и Agent artifact checks — по `checks/<suite>/*.test.js`
во всём monorepo.

Core не заморожен. Условия принятия изменения определены в `AGENTS.md`, а идеи без
принятого intent и публичного контракта остаются в `BACKLOG.md`.
