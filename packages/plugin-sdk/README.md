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

`repository.status` и `repository.sync` получают context, уже привязанный к одному
Repository. Для `repository.connect` Core создаёт setup-context: проверяет project
registration, поддерживаемую role и локальный checkout, но сохраняет новый binding
только после успешного callback. Для остальных операций существующий
`repositories[].plugins` binding обязателен. `repository`, `project.repositories` и
`repositories.list()` содержат только immutable `{ id, role }` handles; filesystem
root этих handles и изменяемая Project model в Plugin не передаются. Для command
action поле `invocation` отдельно сообщает `{ id, role, path }` Repository, из которого
пользователь вызвал CLI; это read-only metadata, а операции с файлами и процессами всё
равно доступны только через scoped facades. `git`, `openspec`, `files` и `process`
автоматически работают в проверенном checkout, а `storage` — только в namespace
текущего Plugin.

`repository.status` возвращает `{ state: string, details?: string }`. Core добавляет
Plugin и Repository identity, а ошибка одного status превращается в `unavailable`,
не прерывая вывод остальных bindings.

`PluginPackage` аналогично инкапсулирует проверку `package.json` и предоставляет
только package identity и ESM entrypoint. Тестовый `PluginContract` связывает обе
модели и проверяет регистрацию команд, не выполняя их actions.

Command action получает позиционные аргументы и последним параметром immutable
snapshot опций. Внутренний Commander `Command` и весь CLI tree Plugin не передаются.

Вложенные команды, options и Repository context объявляются тем же builder:

```js
commands.command("inspect")
  .description("Inspect repository")
  .command("dependencies")
  .description("Inspect dependencies")
  .option("--format <format>", "Output format", { choices: ["text", "json"] })
  .actionWithContext(async (context, options) => {
    context.logger.info(`${context.repository.id}: ${options.format}`);
  }, { scope: "current", requireBinding: true });
```

`scope: "current"` привязывает facades к Repository вызова, а `scope: "store"` — к
Store. `requireBinding` по умолчанию равен `true`; значение `false` предназначено
только для команды, которая должна работать до `plugin connect`. Plugin не должен
искать checkout самостоятельно или использовать `invocation.path` как execution root.

## Contract test

```js
import manifest from "../package.json" with { type: "json" };
import plugin from "../index.js";
import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

testPluginContract({ plugin, packageManifest: manifest });
```
