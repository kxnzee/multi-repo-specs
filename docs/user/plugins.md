# Plugins

Plugin — самостоятельный npm package, который расширяет Orchestrator через публичный
`@openspec-orch/plugin-sdk`. Plugin может предоставить:

- lifecycle для выбранных Store или Code Repositories;
- собственные команды внутри namespace `openspec-orch <plugin-id>`;
- установку и удаление принадлежащих ему MCP entries и Agent instructions.

Plugin Package не входит в Base Template и не требует изменений Core. Project
Template может объявить его ID обязательным расширением через `requires.plugins`;
Package при этом остаётся самостоятельным и владеет собственным `template/`.

Если общий project workflow поддерживает необязательный Plugin, Base может оставить
единый entrypoint и условный handoff по Plugin ID. Сами инструкции Plugin при этом
поставляются только его `template/`: например, Base
`openspec-base-apply-context` обрабатывает Standard Apply, а подключённому Change
Tracking передаёт Cycle preflight через установленный
`change-tracking-apply-context`. Если Plugin не установлен, его skill отсутствует и
handoff не выполняется.

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
openspec-orch plugin status --plugin codegraph
openspec-orch plugin sync codegraph --all
openspec-orch plugin exec codegraph --all -- status --json
openspec-orch plugin exec openspec-graph --repo specs -- graph status --json
openspec-orch plugin exec change-tracking --repo specs -- status <change-id> --json
openspec-orch plugin disconnect codegraph --repo frontend
openspec-orch plugin remove codegraph
```

Status-команды без `--json` предназначены для человека: они показывают состояние
через `✓`, `⚠` и `✗`, а вложенные Plugin details — как компактное дерево. Флаг
`--json` сохраняет стабильный машиночитаемый контракт для CI, скриптов и агентов.
Долгие операции показывают spinner в TTY и построчный progress в CI/non-TTY.
Progress всегда идёт в `stderr`, поэтому JSON и raw output `plugin exec` остаются
пригодными для перенаправления. После `plugin connect` и `plugin sync` результат
подтверждается новым вызовом `repository.status`, а не только успешным глаголом.

Для единого графа Store используется отдельный Store-only Plugin:

В текущем Base Project Template он устанавливается автоматически как required.
Команда `plugin init` ниже нужна только Custom Template без этой зависимости или
для явного восстановления установки:

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

Подключение `openspec-graph` не строит индекс автоматически и не блокируется
Intake-only или Proposal-only Change. До явного `graph build` статус Plugin ожидаемо
равен `unavailable`; сам build по-прежнему требует строгой валидности OpenSpec. В
пустом Store build допустим сразу, а незавершённый активный Change сначала должен
дойти до валидных Delta Specs.

Он строит типизированную Store-level модель: Store содержит Repository, Change
содержит Delta Spec и влияет на Master Spec, Delta Spec изменяет Master Spec, а
explicit relations связывают Specs и Repositories. Модель не пересекается с
CodeGraph, который индексирует файлы и символы внутри Code Repositories. Формат
`openspec/graph.yaml`, строгие проверки и UI описаны в
[OpenSpec Graph Plugin](../../plugins/openspec-graph/README.md).

Перед `inspect`, `impact`, `check-scope` или `view` требуется `graph status --json`
со `state: ready` и `authoritative: true`. Для `stale` или `unavailable` выполните
`next_command` и повторите status; `invalid` требует исправления inputs. Last-known-
good предназначен только для диагностики.

`disconnect` удаляет только binding из `openspec-orch.yaml` и не удаляет данные,
созданные инструментом внутри Repository. `remove` разрешён после отключения Plugin
от всех repositories. Для Plugin с `required: true` удаление дополнительно блокируется:
сначала примените Project Template, который больше не содержит этот ID в
`requires.plugins`. Package и доставленные им файлы автоматически не удаляются.

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

Для стабильных пользовательских операций Plugin объявляет точную grammar через
публичный command builder. Фактическую grammar установленного Plugin показывает
`openspec-orch <plugin-id> --help`.

Для редкой диагностики или доступа к команде внутреннего Package без расширения Core
используйте универсальный passthrough:

```bash
openspec-orch plugin exec <plugin-id> [--repo <repository-id>]... [--all] -- <command> [args...]
```

Повторяемый `--repo` выбирает один или несколько подключённых Plugin instances.
Без `--repo` и `--all` интерактивный терминал показывает checkbox; в CI и другом
non-TTY режиме требуется явный selector. `--all` без prompt выбирает все подходящие
repositories для `connect` или все существующие bindings для `sync`, `exec` и
`disconnect`. `--repo` и `--all` нельзя использовать вместе. Core не интерпретирует
хвост после `--`: каждый выбранный Plugin instance получает одинаковый immutable
массив строк.
Если Package предоставляет `repository.exec`, как CodeGraph, argv передаётся его
native runtime с проверенным Repository cwd, timeout и ограничениями
`PluginContext.process`. Иначе SDK исполняет command grammar из `registerCommands`,
как для OpenSpec Graph и Change Tracking. Store-scoped command требуется запускать
через Store instance; если Plugin связан также с Code Repositories, укажите Store
через `--repo`, иначе выбор несовместимого instance остановится с
`PLUGIN_EXEC_SCOPE_MISMATCH`.

## Создание пользовательского Plugin

Новый Package можно создать вне Store:

```bash
# Минимальный commands-плагин (профиль по умолчанию)
openspec-orch plugin register dependency-audit

# Repository lifecycle и встроенный exec через registerCommands
openspec-orch plugin register dependency-audit ../team-plugins/dependency-audit \
  --name "Dependency Audit" --profile repository --support store --support code

# Адаптер к отдельному native CLI и каркас Plugin Template
openspec-orch plugin register code-analyzer ../team-plugins/code-analyzer \
  --profile native --support code --template
```

| Profile | Scaffold |
|---|---|
| `commands` | Только `registerCommands`; `supports` и Repository lifecycle отсутствуют |
| `repository` | `connect/status` с явными NOT_IMPLEMENTED guards и `registerCommands` |
| `native` | `connect/status`, `repository.exec` adapter и `bin/<plugin-id>.js` |

`commands` используется по умолчанию. `--support` разрешён только для
`repository` и `native`; без него выбирается `code`. Флаг `--template` добавляет
`template/template.yaml` с `agents: {}`. Автор добавляет только поддерживаемые Agent
ID и их `copy` operations; Base agent adapter metadata повторять не требуется.
Scaffold не возвращает фиктивный `ready`: Repository author обязан реализовать
`connect/status` перед установкой.

Без явного пути создаётся `./plugins/dependency-audit/`:

```text
dependency-audit/
├── package.json
├── index.js
├── README.md
└── test/
    └── plugin.test.js
```

Для `native` дополнительно создаётся `bin/`, для `--template` — `template/`.
`plugin.yaml` не используется. Единственная Plugin entrypoint объявляется в
`package.json`:

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
  registerCommands(commands) {
    commands.command("inspect")
      .description("Проверить Plugin")
      .action(() => console.log("dependency-audit: ready"));
  },
});
```

`supports` по умолчанию равен пустому списку и не указывается для commands-only
Plugin. `repository.connect` и `repository.status` обязательны только для Repository
contribution; `repository.sync`, Agent integration и команды необязательны. Хотя бы
один contribution должен присутствовать.

Для Repository Plugin с `registerCommands` универсальный `plugin exec` использует
ту же grammar автоматически:

```bash
openspec-orch plugin exec dependency-audit --repo <repository-id> -- inspect
```

Одинаковый `repository.exec` добавлять не нужно. Он предназначен только для Plugin,
который передаёт argv собственному native runtime.
Commands-only Plugin запускается напрямую как `openspec-orch dependency-audit inspect`
и не требует Repository binding.

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
