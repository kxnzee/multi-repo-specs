# Plugin Platform

## Package contract

Plugin — ESM package с одним entrypoint:

```json
{
  "name": "@company/openspec-plugin-example",
  "version": "1.0.0",
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

Loader проверяет package identity, entrypoint внутри package root и структурный
Plugin API. Совпадение `instanceof` не требуется.

## Contributions

`definePlugin` требует хотя бы один contribution:

- `commands` — декларативная grammar в namespace Plugin;
- `repository` — `connect/status` и optional `sync/exec`;
- `extensions` — data-only Agent Extension для Store или Code Repository.

```js
import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "dependency-audit",
  registerCommands(commands) {
    commands.command("inspect")
      .description("Inspect dependencies")
      .action(async () => {});
  },
});
```

Commands-only Plugin не требует binding. Repository contribution объявляет
поддерживаемые roles. Native `repository.exec` нужен только для непрозрачного argv
passthrough; иначе SDK может выполнить зарегистрированную grammar.

## PluginContext

Core создаёт новый scoped context для каждого invocation:

- immutable `project`, `repositories`, `repository` и `invocation`;
- `files` для безопасных relative paths;
- read-only `git` operations;
- OpenSpec version check;
- `process` с executable, immutable argv, cwd, timeout и redaction;
- versioned `storage`;
- Agent identity и logger.

Plugin не получает checkout paths через Repository handles и не должен искать их
самостоятельно.

## Extensions

Extension declaration содержит package-relative `root` и точный target. Core
проверяет realpath, manifests и ID всех providers до mutation. Native lifecycle
выполняет выбранный Agent adapter.

Plugin-owned Extension подключается и отключается вместе с binding. Отдельного
`agent.integration` API и Template fallback нет.

## Selection и output

Для multi-repository lifecycle повторяемый `--repo` выбирает IDs, `--all` —
все candidates или bindings. Флаги несовместимы. Без selector non-TTY завершается
ошибкой, TTY показывает выбор.

Progress пишется в stderr; structured output остаётся в stdout. Ошибка одного instance
не считается общим успехом.

## External packages

`plugin init --from` принимает npm spec, Git URL, tarball или локальный package.
Core создаёт Store-local runtime, устанавливает production dependencies без lifecycle
scripts и сохраняет exact identity. Bundled Plugins загружаются из distribution.

Template не управляет Plugins.

## Проверка Plugin

```js
import manifest from "../package.json" with { type: "json" };
import plugin from "../index.js";
import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

testPluginContract({ plugin, packageManifest: manifest });
```

Contract test проверяет manifest, public export и contribution shape без импорта Core.
