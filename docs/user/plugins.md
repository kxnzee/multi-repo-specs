# Plugins

Plugin — самостоятельный npm package, который расширяет Orchestrator через публичный
`@openspec-orch/plugin-sdk`. Plugin может предоставить:

- lifecycle для выбранных Store или Code Repositories;
- собственные команды внутри namespace `openspec-orch <plugin-id>`;
- установку и удаление принадлежащих ему MCP entries и Agent instructions.

Plugins не входят в Project Template и не требуют изменений Core.

## Основной lifecycle

Из корня Store выполните:

```bash
openspec-orch plugin init
openspec-orch plugin connect <plugin-id>
openspec-orch plugin status
```

Без аргументов `plugin init` показывает checkbox пакетов стандартной поставки, а
`plugin connect` — подходящие repositories. Для CI и скриптов используйте явные
аргументы:

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend --repo backend
openspec-orch plugin status --plugin codegraph --json
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin disconnect codegraph --repo frontend
openspec-orch plugin remove codegraph
```

Для единого графа Store используется отдельный Store-only Plugin:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph build
openspec-orch graph status
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
openspec-orch graph inspect <node-id>
openspec-orch graph view
```

Он строит Store → Repository → Master Spec → Change → Delta Spec projection и не
пересекается с CodeGraph, который индексирует файлы и символы внутри Code
Repositories. Формат
`openspec/graph.yaml`, строгие проверки и UI описаны в
[OpenSpec Graph Plugin](../../plugins/openspec-graph/README.md).

`disconnect` удаляет только binding из `openspec-orch.yaml` и не удаляет данные,
созданные инструментом внутри Repository. `remove` разрешён после отключения Plugin
от всех repositories.

Если Plugin предоставляет Agent integration, `plugin init` устанавливает её для
Agent, зарегистрированного командой `openspec-orch init`. После изменения MCP-конфига
перезапустите агент. Core не знает provider-specific форматы: Plugin сам владеет
своими MCP entries, инструкциями и симметричным удалением.

## Установка внешнего Package

`--from` принимает локальный каталог, `.tgz`, Git URL или npm install spec. Для одного
вызова укажите ровно один source и один Plugin ID:

```bash
openspec-orch plugin init --plugin dependency-audit --from ../team-plugins/dependency-audit
openspec-orch plugin init --plugin jira --from @company/openspec-plugin-jira@1.2.0
openspec-orch plugin init --plugin dependency-audit --from ./dependency-audit-2.0.0.tgz
```

Production dependencies внешнего Package устанавливаются без lifecycle scripts в
`.openspec-orch/cache/plugin-runtimes/<plugin-id>/`. Пакеты стандартной поставки уже
являются dependencies Orchestrator и загружаются из его установки без копирования в
Store-local runtime.

Package и его launcher должны разрешать собственные зависимости относительно своей
точки входа. Наличие executable в глобальном `PATH` или `node_modules` подключённого
Code Repository не предполагается.

## Команды Plugin

Plugin регистрирует точную CLI grammar через SDK. По умолчанию команды монтируются в
его namespace:

```bash
openspec-orch dependency-audit inspect
openspec-orch dependency-audit scan --help
```

Core не передаёт произвольные «native args» внешнему executable. Позиционные
аргументы, options и Repository context объявляет сам Plugin через публичный command
builder. Фактическую grammar установленного Plugin показывает
`openspec-orch <plugin-id> --help`.

## Создание пользовательского Plugin

Новый Package можно создать вне Store:

```bash
openspec-orch plugin register dependency-audit
openspec-orch plugin register dependency-audit ../team-plugins/dependency-audit \
  --name "Dependency Audit" --support store --support code
```

Без явного пути создаётся `./plugins/dependency-audit/`:

```text
dependency-audit/
├── package.json
├── index.js
├── README.md
└── test/
    └── plugin.test.js
```

`plugin.yaml` и отдельный обязательный executable не используются. Единственная
точка входа объявляется в `package.json`:

```json
{
  "name": "openspec-orch-plugin-dependency-audit",
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

Минимальный entrypoint использует только публичный SDK:

```js
import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "dependency-audit",
  supports: ["code"],
  repository: {
    async connect(context) {},
    async status(context) {
      return { state: "ready" };
    },
  },
  registerCommands(commands) {
    commands.command("inspect")
      .description("Проверить Plugin")
      .action(() => console.log("dependency-audit: ready"));
  },
});
```

`repository.connect` и `repository.status` обязательны только для Repository
contribution; `repository.sync`, Agent integration и команды необязательны. Хотя бы
один contribution должен присутствовать.

После реализации сначала проверьте Package, затем установите его из корня Store:

```bash
cd ../team-plugins/dependency-audit
npm install
npm test

cd <абсолютный путь до Store>
openspec-orch plugin init --plugin dependency-audit \
  --from <абсолютный путь до dependency-audit>
```

Публичный API, `PluginContext` и contract test kit описаны в
[Plugin SDK](../../packages/plugin-sdk/README.md). Plugin не импортирует Core internals
и не зависит от порядка загрузки других Plugins.
