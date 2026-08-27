# OpenSpec Orchestrator Plugin SDK

Минимальный публичный контракт для доверенных in-process Plugins. SDK не загружает
пакеты, не создаёт Core services и не выполняет lifecycle callbacks.

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

`definePlugin` проверяет definition и возвращает immutable доменную модель `Plugin`,
но ничего не регистрирует и не запускает. Core работает с Plugin только через её
публичные методы: `supportsRole`, `assertSupports`, `hasRepositoryContribution`,
`connect`, `status`, `canSync`, `sync`, `canExec`, `exec`,
`hasAgentContribution`, `integrateAgent`, `hasCommandContribution` и
`registerCommands`. Loader проверяет этот API структурно и не
зависит от `instanceof`, поэтому разные физические копии SDK не ломают загрузку.
`exec` автоматически встроен для Plugin с `registerCommands` и использует
зарегистрированную grammar. Объявлять одинаковый `repository.exec` в каждом Plugin
не нужно. Методы `canExec` и `exec` входят в публичную структурную границу, а
optional contribution `repository.exec` требуется только для native passthrough, когда argv
должен целиком уйти Package-owned runtime, как в CodeGraph. Plugin без
`registerCommands` и `repository.exec` продолжает загружаться, но универсальный
passthrough для него недоступен.

`supports` можно не указывать для commands-only Plugin: SDK использует пустой
список. Если объявлен `repository`, требуется хотя бы одна role в `supports` и
обязательные callbacks `connect/status`.

Необязательный `agent.integration(context)` предоставляет два публичных варианта:

- `{ install, remove }` — imperative lifecycle для provider-specific merge или MCP;
- `{ copy: [{ from, to }] }` — declarative file overlay из корня Plugin Package.

Declarative `copy` применяет тот же безопасный copy contract, что и Template, и
заменяет автоматический `template/` этого Plugin. Если `agent` contribution не
объявлен, Core автоматически ищет `template/template.yaml` и применяет
`agents.<current-agent>.copy`. Удаление не стирает доставленные файлы: `remove`
возвращает их Store-relative paths для ручной очистки.

Порядок загрузки Plugins не специфицирован. Plugin не должен полагаться на то, что
другой Plugin загружен или зарегистрирован раньше.

Plugin импортирует только `@openspec-orch/plugin-sdk`. Доступ к Project,
repositories, Git, OpenSpec, files, process, storage, Agent и logger предоставляется
Core через новый immutable `PluginContext` для каждого invocation.

`repository.status`, `repository.sync` и `repository.exec` получают context, уже привязанный к одному
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

`repository.exec(context, args)` — низкоуровневый passthrough для редких Package-owned
операций. `args` — непустой immutable массив строк после разделителя `--` в команде
`openspec-orch plugin exec <plugin-id> [--repo <repository-id>]... [--all] -- <command> [args...]`.
SDK не разбирает native grammar; Plugin передаёт argv своему runtime через scoped
`context.process` и не ищет Repository checkout самостоятельно. Повторяемый `--repo`
выбирает конкретные instances, `--all` — все связанные instances, а отсутствие обоих
selector в интерактивном терминале открывает checkbox.

Для Repository Plugin без `repository.exec` тот же вызов исполняет зарегистрированные
команды внутри SDK. В этом случае argv должен включать полный command path Plugin,
например `graph inspect --json` для OpenSpec Graph. `scope: "store"` требует выбрать
Store через `--repo`, когда Plugin связан и с Code Repositories; SDK не подменяет
выбранные Plugin instances другим context.

`PluginPackage` аналогично инкапсулирует проверку `package.json` и предоставляет
только package identity и ESM entrypoint. Тестовый `PluginContract` связывает обе
модели и проверяет регистрацию команд, не выполняя их actions.

Command action получает позиционные аргументы и последним параметром immutable
snapshot опций. Внутренний Commander `Command` и весь CLI tree Plugin не передаются.

SDK экспортирует `createCliProgress()` и `CliProgressRenderer` для Core и встроенных
Plugin commands. Renderer пишет только в `stderr`: показывает spinner в TTY и
стабильные строки в non-TTY/CI. Метод `run(message, operation, { success, failure })`
пишет начальный progress до ожидания Promise, сохраняет результат operation и
повторно выбрасывает исходную ошибку после строки `✗`.

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
