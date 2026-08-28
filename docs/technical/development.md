# Разработка Orchestrator

## Структура monorepo

| Путь | Назначение |
|---|---|
| `bin/openspec-orch.js` | Composition root CLI и distribution policy |
| `packages/core/` | Domain, use cases, adapters и generic Plugin host |
| `packages/plugin-sdk/` | Единственный публичный API для Plugins |
| `plugins/change-tracking/` | Cycle/Receipts/Snapshot |
| `plugins/codegraph/` | CodeGraph lifecycle, launcher и Repository-scoped Agent Extension |
| `plugins/openspec-graph/` | Store graph, queries и viewer |
| `agents/` | Distribution-owned Agent definitions и provider-specific native adapters |
| `extensions/` | Bundled standalone Agent Extensions |
| `templates/base/` | Default Project Template |
| `packages/core/templates/plugin-extension/` | Agent artifacts scaffold создаваемого Plugin |
| `test/` | Distribution integration tests |
| `checks/template/` | Structural contract Project Template |
| `checks/agent-artifacts/` | Skills/commands/subagents contract checks |

Package-specific code tests находятся в `packages/*/test/` и `plugins/*/test/`.
Non-code suite обнаруживается по `checks/<suite>/*.test.js` в root/package/plugin без
отдельного hardcoded npm script на каждый package.

## Правила изменения Core

Изменение Core должно сохранять его generic boundary:

- принят product intent и public contract;
- выбран минимальный coherent implementation;
- generic Core не получает Plugin-specific grammar или методы;
- observable behavior защищено regression tests.

Новый first-party Plugin регистрируется в composition root, но его domain остается в
собственном package. Изменение Plugin lifecycle или public SDK требует проверки Core
Loader/Host, SDK contract kit и external plain export.

## Добавление Plugin

1. Создайте отдельный package через `plugin register` или вручную.
2. Используйте только публичный SDK.
3. Определите contribution и точные supported roles.
4. Реализуйте `status` как фактическую проверку, а не всегда-ready stub.
5. Для native runtime используйте `context.process`, не глобальный shell.
6. Добавьте package tests и SDK contract test.
7. Для bundled distribution добавьте dependency/catalog entry и, если нужны root
   commands, точную composition policy.
8. Проверьте package packing и installation smoke.

## Добавление Agent и Extension

1. Добавьте Agent definition и adapter в `agents/<id>/`; Template менять не нужно.
2. Для каждого bundled Extension добавьте native manifest нового Agent.
3. Provider adapter реализует
   `adaptOpenSpecPack/preflight/validateExtension/invokeExtension` вне generic Core;
   общий формат можно переиспользовать, как Qwen-compatible adapter GigaCode.
4. Обновите user documentation, Agent/Extension structural tests и package inventory.
5. Выполните реальный native runtime smoke, прежде чем объявлять поддержку
   проверенной.

Наличие manifest внутри одного Extension не расширяет distribution Agent catalog.

Новый standalone Extension размещается в `extensions/<id>/`, содержит
`extension.yaml` и manifests Claude/Qwen/GigaCode и обнаруживается composition root
без списка ID в Core. Plugin-owned Extension размещается внутри package и возвращается
через `extensions(context)` с Store/Repository target.

## Проверки

Минимальный полный набор:

```bash
npm run lint
npm run test:code
npm run check:template
npm run check:agent-artifacts
npm run check
git diff --check
node bin/openspec-orch.js --help
```

Перед публикацией:

```bash
npm pack --dry-run
npm pack --workspaces --dry-run
```

Unit/integration tests не доказывают внешний provider runtime, native CodeGraph,
реальный Git hosting или произвольную OpenSpec version. Для изменения такой границы
нужен отдельный isolated smoke с реальным executable.

## Что проверяет `npm run check`

1. ESLint и import boundaries.
2. Workspace package tests.
3. Distribution integration tests.
4. Project Template structural checks.
5. Agent artifact checks.

Documentation не является входом test suite и требует отдельной link/consistency
проверки.

## Настройки и константы

`packages/core/internal/settings.js` содержит изменяемые operational defaults:
timeouts, strict default, repository directory, concurrency и параметры OpenSpec
init. Их изменение может менять project policy.

Статические versions, regex и service paths собраны в
`packages/core/internal/constants.js`. CLI grammar и YAML fields остаются рядом со
своими command/schema contracts.

## Review checklist

- public behavior подтвержден тестом;
- Core/SDK/Plugin import boundaries сохранены;
- scoped path/cwd не расширены;
- structured stdout не загрязнен progress;
- lifecycle mutation выполняется только после validation/status;
- versioned storage не мигрируется молча;
- Template не перезаписывает user-owned file;
- documentation описывает реализованное поведение, а future proposal явно отделен.
