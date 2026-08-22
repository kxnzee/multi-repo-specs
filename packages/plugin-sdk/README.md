# OpenSpec Orchestrator Plugin SDK

Минимальный публичный контракт для доверенных in-process Plugins. SDK не загружает
пакеты, не создаёт Core services и не выполняет lifecycle callbacks.

```js
import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "demo",
  supports: ["code"],
  repository: {
    async connect(context) {},
    async status(context) {
      return { state: "ready" };
    },
  },
  registerCommands(commands) {
    commands.command("hello")
      .description("Demo command")
      .action(async () => {});
  },
});
```

`definePlugin` проверяет definition и возвращает immutable доменную модель `Plugin`,
но ничего не регистрирует и не запускает. Core работает с Plugin только через её
публичные методы: `assertSupports`, `connect`, `status`, `sync`,
`registerCommands` и `integrateAgent`. Loader проверяет этот API структурно и не
зависит от `instanceof`, поэтому разные физические копии SDK не ломают загрузку.

Порядок загрузки Plugins не специфицирован. Plugin не должен полагаться на то, что
другой Plugin загружен или зарегистрирован раньше.

Plugin импортирует только `@openspec-orch/plugin-sdk`. Доступ к Project,
repositories, Git, OpenSpec, files, process, storage, Agent и logger предоставляется
Core через новый immutable `PluginContext` для каждого invocation.

`PluginPackage` аналогично инкапсулирует проверку `package.json` и предоставляет
только package identity и ESM entrypoint. Тестовый `PluginContract` связывает обе
модели и проверяет регистрацию команд, не выполняя их actions.

## Contract test

```js
import manifest from "../package.json" with { type: "json" };
import plugin from "../index.js";
import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

testPluginContract({ plugin, packageManifest: manifest });
```
