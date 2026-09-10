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

Agent contribution обнаруживается distribution без специальных Plugin IDs как у
bundled, так и у объявленных в Project внешних Plugins. Общий MCP/runtime валидирует
и маршрутизирует immutable tool metadata, но tool handler, availability fallback и
response overlays остаются в owning Plugin package.
Agent-only Plugin без Repository contribution получает Store-scoped context с
исходным `invocation`, не требуя поддержки role `store`. Для Repository contribution
сохраняется проверка поддерживаемой role, а `requireBinding` требует Store binding
для вызовов без явного выбора Repository.

Repository contribution может объявить `supports: ["store", "specs"]`. Core
не расширяет поддержку существующих Plugins автоматически. Вызов для `specs`
проверяет Store ID и файлы metadata до создания контекста. Plugin-owned
Extensions на этой роли отклоняются до repository `connect`; standalone
Extensions по-прежнему имеют только targets `store` и `code`.

Agent tool объявляет `repositoryParameter: "store_repository_id"` (или другое
предметное имя) и одноимённое строковое поле в собственной `inputSchema`. SDK
проверяет наличие строкового поля; описание поля должно объяснять область действия
и значение по умолчанию. Для внешних Plugins сохранён `repositoryScoped: true`
как прежний способ выбрать поле `repository_id`; одновременно два способа запрещены. Runtime выбирает Repository из
основного проекта, проверяет binding и поддержку роли и передаёт контекст в
`agent.create`. Без поля сохраняется основной Store. Явный селектор всегда
требует binding, даже если `agent.requireBinding` выключен. Overlays общего
контекста остаются привязанными к основному Store.

## PluginContext

Core создаёт новый scoped context для каждого invocation:

- immutable `project`, `repositories`, `repository`, `targetStore` и `invocation`;
- `files` для безопасных relative paths и атомарного read-modify-write через `update`;
- read-only `git` operations;
- OpenSpec version check;
- `process` с executable, immutable argv, cwd, timeout и redaction;
- versioned `storage`;
- Agent identity и logger.

Plugin не получает checkout paths через Repository handles и не должен искать их
самостоятельно.

`project` и `repositories` всегда описывают основной проект. `repository` —
выбранное подключение. `targetStore` для `store` и `specs` содержит `{ id,
repositories: [{ id, role }] }` именно целевого Store; для `code` равен `null`.
Его repository handles являются описаниями и не разворачивают checkout команды.
`files`, `git` и `process` привязаны к выбранному checkout. Чтобы команда работала
с выбранным `store` или `specs`, используйте `scope: "current"`: `scope: "store"`
продолжает требовать роль `store`.
Получение `repositories.git(id)` для `specs` проверяет ID и файлы метаданных
целевого Store так же, как создание прямого PluginContext для этого подключения.
`await repositories.context(id)` создаёт контекст того же Plugin для репозитория
из реестра основного проекта. Вызов перечитывает конфигурацию основного Store,
проверяет binding, поддержку роли, checkout и идентичность `specs`; пути checkout
не раскрываются. Пакеты и зависимости выбранного Store не устанавливаются.

`storage` остаётся общим для Plugin в основном проекте. Если Plugin хранит
состояние нескольких привязок, он разделяет его по `repository.id` внутри своего
payload. Пакеты и состояние чужого проекта не используются как runtime текущего.
Новым Plugins, использующим `specs`/`targetStore`/`repositoryParameter`, нужна версия
поставки с этими контрактами; старый SDK их не предоставляет. Роль не ограничивает
возможности доверенного in-process Plugin как sandbox.

## Extensions

Plugin-owned Extension declaration содержит package-relative `root` и точный target. Core
проверяет realpath, manifests и ID всех providers до mutation. Native lifecycle
выполняет выбранный Agent adapter.

Plugin-owned Extension подключается и отключается вместе с binding. Отдельного
`agent.integration` API и Template fallback нет.

Standalone Extension — отдельный декларативный npm package с `extension.yaml` и
Agent manifests. Его контракт предоставляет `@openspec-orch/extension-sdk`; Core не
загружает из такого package исполняемый entrypoint. Package объявляет непустое
подмножество поддерживаемых Agents; Core отклоняет неизвестные Agent IDs и проверяет
manifest выбранного в Store Agent перед native mutation.

Необязательное поле `targets` в `extension.yaml` задаёт роли: `[store]`, `[code]`
или `[store, code]`. По умолчанию используется `[store]`; пустые, повторяющиеся
и неизвестные роли отклоняются. Lifecycle и диагностика выполняются для каждого
зарегистрированного Repository выбранных ролей. Bundled workflows
`spec-driven-extended` и `superpowers` подключаются к Store и Code Repositories.

```json
{
  "name": "@company/workflow-extension",
  "version": "1.0.0",
  "openspecOrchestrator": {
    "apiVersion": 1,
    "extension": "./extension.yaml"
  }
}
```

```bash
openspec-orch extension init workflow --from @company/workflow-extension@1.0.0
openspec-orch extension connect workflow
openspec-orch extension status workflow
openspec-orch extension disconnect workflow
openspec-orch extension remove workflow
```

```js
import { testExtensionContract } from "@openspec-orch/extension-sdk/testing";

testExtensionContract({ agentIds, descriptor, packageManifest });
```

## Selection и output

Для multi-repository lifecycle повторяемый `--repo` выбирает IDs, `--all` —
все candidates или bindings. Флаги несовместимы. Единственный candidate выбирается
автоматически; при нескольких TTY показывает выбор, а non-TTY требует selector.

Progress пишется в stderr; structured output остаётся в stdout. Ошибка одного instance
не считается общим успехом.

## External packages

`plugin init --from` принимает npm spec, Git URL, tarball или локальный package.
Core добавляет package в единый private npm-проект Store и устанавливает production
dependencies без lifecycle scripts. npm фиксирует dependency graph в lockfile;
`openspec-orch.yaml` хранит только Plugin ID. Bundled Plugins загружаются из distribution.
`plugin update <id> --from <source>` является единственным явным обновлением версии;
`connect` может лишь восстановить уже зафиксированный lock. `package status` сверяет
имя и версию установленного package, а также SHA-256 полного lockfile с отметкой
успешной установки в `node_modules/.openspec-orch-lock.sha256`. Изменение Git commit,
integrity или транзитивной зависимости обнаруживается даже при прежней версии
прямого package. При несовпадении или отсутствии отметки runtime получает `stale`;
`package sync` восстанавливает и отсутствующий, и устаревший runtime. Отметка
удаляется перед npm mutation и записывается только после успешной установки и
проверки packages; неуспешный sync не делает runtime готовым.

Template не управляет Plugins.

## Проверка Plugin

```js
import manifest from "../package.json" with { type: "json" };
import plugin from "../index.js";
import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

testPluginContract({ plugin, packageManifest: manifest });
```

Contract test проверяет manifest, public export и ту же command grammar, которую
исполняет runtime, без запуска actions и без импорта Core. Plugin обязан объявить
совместимый диапазон `@openspec-orch/plugin-sdk` в `peerDependencies`.

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

Шаблоны Agent Extension принадлежат поставке и находятся в
`bin/templates/plugin-extension/`. CLI передаёт их каталог в
`new PluginScaffoldService({ extensionTemplateRoot })`. Core обрабатывает файлы
шаблона, не выбирая провайдеров и не храня их манифесты.

При прямом использовании Core API для `extension: true` передайте абсолютный
`extensionTemplateRoot`; без него операция завершится ошибкой до создания файлов.
Для плагинов без Extension этот параметр не требуется. Команда CLI и создаваемые
ею файлы сохраняют прежний формат.

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
просмотрите изменения `.openspec-orch/packages/package.json`, `package-lock.json` и
`openspec-orch.yaml`, затем выполните `plugin status` и `doctor`.
Повторный `plugin connect` восстанавливает Agent Extension существующего binding, но не
заменяет Plugin-specific `sync` или migration. Обновление Plugin проходит тем же
reviewable Store flow; Template не должен устанавливать или обновлять Plugins.

### Repository вызова CLI

`plugin exec --repo <target>` выбирает цель команды, а `context.invocation`
описывает зарегистрированный checkout вызова, в том числе из вложенного каталога.
При нескольких целях invocation остаётся одним и тем же. Для Change Tracking
цель — Store, а invocation должен быть назначенным Code Repository; запуск из
Store не подменяет эту identity выбранным `--repo`. CLI и MCP используют общий
resolver текущего Repository. Git worktrees определяются по регистрации Git, включая
копии вне основного checkout; посторонний вложенный Git-репозиторий не наследует ID.
`context.repositories.git(id)` для Repository вызова использует эту рабочую копию,
для остальных ID — зарегистрированный основной checkout.

Git facade предоставляет read-only `isAncestor(ancestor, descendant)` для полных
commit hashes. Он возвращает `false` для несвязанной истории; ошибки Git и неизвестные
commits не превращаются в отрицательный результат проверки.

`hasCommit(revision)` возвращает `false` только при отсутствии commit; сбои запуска
Git и повреждённый checkout остаются ошибками.

Native Agent adapters проверяют актуальность файлов при `status` и после `connect`.
Параметр `refresh: true` допустим только для `connect`; user-level CLI передаёт его
из `agent setup --refresh`. Обновление использует native lifecycle и не удаляет
установку с её настройками. Издатель повышает native manifest version при изменении
payload. Неизменившийся cache после native update остаётся ошибкой `STATUS_STALE`.

### Абстрактные операции MCP

MCP владеет абстрактным контрактом `record_implementation` и прежними контрактами
`start_attempt` / `complete_attempt`. Change Tracking
регистрирует обработчики через `agent.operations`; общий runtime выбирает их по
имени операции без знания ID плагина. Другой Plugin может реализовать тот же
контракт. Два объявленных в Project провайдера одной операции вызывают ошибку
неоднозначности; отсутствие провайдера означает недоступную возможность.

Git, evidence и проверка условий завершения остаются в Change Tracking. Поля
`tracking` и `capabilities.tracking` он добавляет через `agent.enhance`, как остальные
плагины добавляют свои данные. Имена, аргументы и JavaScript-методы MCP сохранены.
