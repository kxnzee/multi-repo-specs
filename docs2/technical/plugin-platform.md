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

### Agent

Agent contribution может вернуть imperative `install/remove` для provider-specific
semantic merge или декларативный `copy`. Core не интерпретирует MCP format. Операция
должна быть симметричной настолько, насколько позволяет provider; delivered files
всегда перечисляются для контролируемой очистки.

### Plugin Template

Package может содержать `template/` и mapping `agents.<id>.copy`. Если явная Agent
contribution отсутствует, Core применяет Template автоматически для каждого
зарегистрированного Agent. Plugin descriptor не повторяет Base mapping metadata.

## Public Plugin object

Структурная поверхность включает:

```text
id, supports, supportsRole, assertSupports,
hasRepositoryContribution, connect, status, canSync, sync, canExec, exec,
hasAgentContribution, integrateAgent,
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

## Required Plugins

Project Template объявляет только ID в `requires.plugins`. Catalog composition root
разрешает ID в package source. Успешный init сохраняет declaration с
`required: true` и применяет обычный Plugin lifecycle.

Если новый Template больше не требует ID, Plugin остается установленным, но теряет
required flag. Автоматического remove нет.

## Authoring и проверки

```bash
openspec-orch plugin register example --profile repository --support code --template
cd plugins/example
npm install
npm test
```

Package tests должны использовать `@openspec-orch/plugin-sdk/testing`, проверять
manifest/export, contribution shape, status semantics и command grammar. Plugin test
не импортирует Core и не полагается на порядок других Plugins.
