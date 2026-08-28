# Plugin Platform

## Package contract

Plugin — ESM package с единственным entrypoint, объявленным в `package.json`:

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

Loader проверяет manifest, допустимую package identity, entrypoint внутри package
root и полный структурный Plugin API. Для external export обязательны методы public
Plugin object, включая `canExec` и `exec`; класс Core или `instanceof` не требуются.

## Contributions

`definePlugin` принимает хотя бы один contribution.

### Commands

```js
export default definePlugin({
  id: "dependency-audit",
  registerCommands(commands) {
    commands.command("inspect")
      .description("Inspect dependencies")
      .action(() => console.log("ready"));
  },
});
```

Builder поддерживает nested commands, arguments, options, choices/parsers и action с
ограниченным PluginContext. Plugin не получает Commander instance. Duplicate/reserved
paths отклоняются до выполнения action.

Commands-only Plugin запускается через собственный namespace и не требует binding:

```bash
openspec-orch dependency-audit inspect
```

### Repository

Repository contribution объявляет поддерживаемые roles и обязательные
`connect/status`. `sync` и native `exec` необязательны. Lifecycle получает context
ровно выбранного Store или Code Repository.

Если `registerCommands` уже существует, универсальный `plugin exec` умеет выполнить
эту grammar для Repository Plugin. `repository.exec` нужен только для передачи argv
собственному native runtime.

### Extensions

Plugin возвращает data-only declarations с package-relative `root` и точным
Store/Repository `target`. Core разрешает canonical `realpath`, запрещает root symlink
и выход из package, сверяет target и через Agent Adapter проверяет manifests/ID всех
Agent поставки. После этого native `connect/status/update/disconnect` проксируются
выбранному provider adapter. Автоматического Plugin Template fallback нет.

Общий `openspec-orch connect` повторно вызывает repository `connect` для каждого
portable binding, восстанавливая runtime на новой машине, а затем выполняет итоговый
Plugin/Extension status. Адресный повторный `plugin connect` существующего binding
по-прежнему не повторяет repository callback и только реактивирует contribution.

Отдельного `agent.integration` API нет: вся Agent-интеграция Plugin реализуется
только через `extensions` и штатный lifecycle выбранного Agent.

## Public Plugin object

Структурная поверхность включает:

```text
id, supports, supportsRole, assertSupports,
hasRepositoryContribution, connect, status, canSync, sync, canExec, exec,
hasExtensionContribution, extensions,
hasCommandContribution, registerCommands
```

Capability methods возвращают boolean. Loader и SDK contract test kit проверяют
одинаковую межпакетную границу.

## PluginContext

Context создается Core только после Project/Repository validation. Основные facades:

- `project` и `repository` — immutable identity/role/path handles;
- `files` — scoped read/write и safe relative paths;
- `git` — ограниченное чтение Git состояния;
- `process` — executable/argv без shell interpolation, timeout и redaction;
- `storage` — versioned local state с atomic update;
- progress/output — человекочитаемый stderr и чистый stdout.

Repository setup context используется только во время `connect`. Обычные lifecycle и
commands могут требовать binding. Store-scoped action явно запрашивает Store context;
запуск через Code Repository отклоняется как scope mismatch.

## Selection contract

Для repository lifecycle:

- повторяемый `--repo` выбирает точные IDs;
- `--all` выбирает все candidates/bindings;
- оба вместе запрещены;
- без selector TTY показывает stable `[ ]`/`[✓]` checkbox;
- non-TTY требует явный selector.

Core дедуплицирует IDs и выполняет multi-selection с ограниченной concurrency. Ошибка
одного instance не должна выдаваться за общий успех.

## External source materialization

`plugin init --from` принимает npm install spec, Git URL, tarball или локальный
package directory. Core создает Store-local runtime, устанавливает production
dependencies с отключенными lifecycle scripts, проверяет package и сохраняет exact
identity. Bundled package загружается из installation distribution и не копируется в
Store cache.

Secrets нельзя встраивать в HTTP(S) source URL. Package entrypoint и dependencies
разрешаются относительно materialized package, а не глобального PATH или
`node_modules` подключенного Repository.

## Независимость от Template

Template не объявляет обязательные Plugins. Пользователь выбирает Plugins отдельно,
а Project config хранит только их exact package declarations и Repository bindings.
Автоматической установки или удаления Plugin из-за Template нет.

## Authoring и проверки

```bash
openspec-orch plugin register example --profile repository --support code --extension
cd plugins/example
npm install
npm test
```

Package tests должны использовать `@openspec-orch/plugin-sdk/testing`, проверять
manifest/export, contribution shape, status semantics и command grammar. Plugin test
не импортирует Core и не полагается на порядок других Plugins.
