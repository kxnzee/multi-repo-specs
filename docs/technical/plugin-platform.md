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

- `commands` — декларативная grammar за единым `plugin exec`;
- `repository` — `connect/status` и optional `sync/exec`;
- `extensions` — data-only Agent Extension для Store или Code Repository;
- `agent` — Plugin-owned Agent tools и overlays для общего gateway.

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

Agent contribution обнаруживается distribution без специальных Plugin IDs. Общий
MCP/runtime валидирует и маршрутизирует immutable tool metadata, но tool handler,
availability fallback и response overlays остаются в owning Plugin package.

## PluginContext

Core создаёт новый scoped context для каждого invocation:

- immutable `project`, `repositories`, `repository` и `invocation`;
- `files` для безопасных relative paths и атомарного read-modify-write через `update`;
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
все candidates или bindings. Флаги несовместимы. Единственный candidate выбирается
автоматически; при нескольких TTY показывает выбор, а non-TTY требует selector.

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

## Полный developer flow

### 1. Создайте package

```bash
# commands-only Plugin без Repository binding
openspec-orch plugin register dependency-audit /absolute/path/to/dependency-audit

# repository lifecycle для Store и Code Repositories
openspec-orch plugin register dependency-audit /absolute/path/to/dependency-audit \
  --profile repository --support store --support code

# native argv runtime и Plugin-owned Agent Extension
openspec-orch plugin register dependency-audit /absolute/path/to/dependency-audit \
  --profile native --support code --extension
```

`commands` создаёт декларативную команду и не требует binding. `repository` создаёт
`connect/status` и зарегистрированную command grammar. `native` добавляет `bin/` для
непрозрачного argv runtime. Для `repository` и `native` scaffold намеренно оставляет
`connect/status` незавершёнными: реализуйте их до установки.

### 2. Реализуйте и проверьте контракт

```bash
cd /absolute/path/to/dependency-audit
npm install
npm test
npm pack --dry-run
```

Сохраните `testPluginContract`, добавьте regression tests для наблюдаемого поведения и
не импортируйте Core. Extension должна содержать валидные manifests всех заявленных
Agent providers.

### 3. Установите в тестовый Store

```bash
cd /absolute/path/to/workspace/specs
openspec-orch plugin init \
  --plugin dependency-audit \
  --from /absolute/path/to/dependency-audit

# только для repository/native profile
openspec-orch plugin connect dependency-audit --repo frontend
openspec-orch plugin status --plugin dependency-audit --json
openspec-orch doctor
```

Проверьте `plugin exec` для любого profile. Если есть Agent Extension, перезапустите
Agent и проверьте его native status. Тестируйте disconnect/remove по пользовательскому
[операционному flow](../user/plugins.md#проверяемое-отключение-и-удаление).

### 4. Зафиксируйте поставку

После локальной проверки опубликуйте package принятым командой способом: immutable npm
version, tarball или Git revision. В Store замените локальный `--from` на exact source,
просмотрите изменение `openspec-orch.yaml`, затем выполните `plugin status` и `doctor`.
Повторный `plugin connect` восстанавливает Agent Extension существующего binding, но не
заменяет Plugin-specific `sync` или migration. Обновление Plugin проходит тем же
reviewable Store flow; Template не должен устанавливать или обновлять Plugins.
