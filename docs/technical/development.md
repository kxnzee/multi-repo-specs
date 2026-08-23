# Разработка Orchestrator Core

Этот документ описывает границы исходного кода и минимальные проверки для
разработчиков Orchestrator. Пользователям CLI он не нужен.

## Границы кода

- `bin/openspec-orch.js` — composition root публичного CLI;
- `packages/core/` — доменная модель, Core use cases, CLI и generic Plugin host;
- `packages/plugin-sdk/` — единственный API, доступный Plugin packages;
- `plugins/change-tracking/` — команды и домен истории изменений;
- `plugins/codegraph/` — CodeGraph lifecycle, launcher, MCP и Agent instructions;
- `templates/base/` — Project Template, используемый только при `init`;
- `src/` — временная rollback-копия прежней реализации; в npm package не входит;
- `test/` — unit- и интеграционные проверки на временных Git-репозиториях.

Пользовательская поверхность — CLI `openspec-orch`. Для авторов Plugin публичным
контрактом является только `@openspec-orch/plugin-sdk`; импорт Core internals запрещён.

Корневой `package.json` перечисляет Core и first-party Plugins как обычные npm
dependencies. Поэтому установка Orchestrator автоматически устанавливает SDK, оба
Plugin package и их собственные runtime dependencies. Корневой tarball содержит
только CLI composition root и Project Template; исходники workspace-пакетов в нём не
дублируются.

`openspec-orch plugin register <plugin-id> [path]` создаёт весь authoring contract
в отдельном npm package. Добавление нового Plugin не требует изменения Core. Его
dependencies и platform-specific artifacts принадлежат самому Plugin package.

Необязательная Agent contribution является generic lifecycle-границей. Core передаёт
только зарегистрированный Agent ID. Provider-specific пути,
форматы MCP-конфигов, инструкции и server launcher принадлежат конкретному Plugin
Package и не добавляются в Core или Project Template.

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
npm run check
git diff --check
node bin/openspec-orch.js --help
```

До завершения пилота правила заморозки Core определены в `AGENTS.md`, а
кандидаты развития записываются в `BACKLOG.md`.
