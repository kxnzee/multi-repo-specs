# OpenSpec Orchestrator Plugin SDK

`@openspec-orch/plugin-sdk` — единственный публичный API для in-process Plugins.
SDK определяет immutable Plugin model, command builder, scoped contracts и test kit.
Загрузка packages и lifecycle принадлежат Core.

## Минимальный Plugin

```js
import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "demo",
  registerCommands(commands) {
    commands.command("hello")
      .description("Demo command")
      .action(async () => {});
  },
});
```

Plugin объявляет хотя бы один contribution:

- `commands` — namespaced CLI grammar;
- `repository` — `connect/status` и optional `sync/exec`;
- `extensions` — Agent Extension с Store или Repository target.

Commands-only Plugin может не объявлять `supports` и не требует binding.
Repository Plugin объявляет хотя бы одну role. `repository.exec` нужен только для
native passthrough; зарегистрированную grammar SDK исполняет сам.

## Extension contribution

```js
import { defineExtension, definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "codegraph",
  extensions(context) {
    return [defineExtension({
      id: "agent",
      root: "./extension",
      target: context.repository,
    })];
  },
});
```

`root` — package-relative path с `./`, `target` — immutable
`{ id, role }`. Native ID равен `<plugin-id>-<extension-id>`; provider manifests
должны использовать это имя. Extension lifecycle выполняет Orchestrator через
выбранный Agent adapter.

## PluginContext

Core создаёт scoped context для каждого invocation:

- immutable Project/Repository handles;
- optional invocation metadata;
- safe files с атомарным `update` для read-modify-write;
- read-only Git helpers;
- OpenSpec version check;
- process runner без shell interpolation;
- versioned local storage;
- Agent identity и logger.

Plugin не получает произвольный доступ к Core internals и не должен сам искать
checkout. `repository.status` возвращает `{ state, details? }`.

## Command builder

Builder поддерживает nested commands, arguments, options, choices/parsers и actions.
Для доступа к context используется `actionWithContext`:

```js
commands.command("inspect")
  .option("--format <format>", "Output format", {
    choices: ["text", "json"],
  })
  .actionWithContext(async (context, options) => {
    context.logger.info(`${context.repository.id}: ${options.format}`);
  }, { scope: "current", requireBinding: true });
```

`scope` равен `current` или `store`. `requireBinding: false` допустим только
для команды, работающей до `plugin connect`. Progress API пишет в stderr.

## Package contract

```json
{
  "type": "module",
  "exports": "./index.js",
  "openspecOrchestrator": {
    "apiVersion": 1,
    "plugin": "./index.js"
  },
  "peerDependencies": {
    "@openspec-orch/plugin-sdk": "^0.1.0"
  }
}
```

Loader проверяет package identity, entrypoint и structural API. Порядок загрузки
Plugins не специфицирован.

## Contract test

```js
import manifest from "../package.json" with { type: "json" };
import plugin from "../index.js";
import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

testPluginContract({ plugin, packageManifest: manifest });
```

Plugin tests не импортируют Core. Полный lifecycle описан в
[Plugin Platform](../../docs/technical/plugin-platform.md).
