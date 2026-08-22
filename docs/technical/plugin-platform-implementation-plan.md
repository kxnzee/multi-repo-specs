# Plugin Platform: план перехода к микроядру

## 0. Статус документа

Статус: **самостоятельный рабочий план реализации**.

Это не backlog и не описание возможной будущей идеи. Документ фиксирует выбранную
архитектуру, точную последовательность изменений, проверки и критерии завершения.
Сам файл не меняет текущий продуктовый контракт или production-код; реализация по
нему начинается отдельной явной задачей.

План отвечает на практический вопрос: как сохранить существующий CLI, но разделить
его на небольшое Core и самостоятельные in-process Plugins, чтобы третий Plugin
добавлялся без изменений `packages/core` и Template.

## 1. Результат миграции

После выполнения плана система состоит из четырёх частей:

```text
openspec-orchestrator (distribution и CLI composition root)
  |
  +-- Orchestrator Core
  |     Project / Store / Repository / Git / OpenSpec
  |     один Agent / Plugin Host / npm-backed Installer
  |     безопасный Process Runner / namespaced Plugin Storage
  |
  +-- @openspec-orch/plugin-sdk
  |     definePlugin / PluginContext / contract test kit
  |
  +-- @openspec-orch/plugin-change-tracking
  |     Change history / Cycle / Assignment / Receipts / Snapshot / Verification
  |
  +-- @openspec-orch/plugin-codegraph
        CodeGraph lifecycle / launcher / MCP declaration / instructions
```

Core не содержит терминов `CodeGraph`, `Cycle`, `Receipt`, `Snapshot` и не знает
команды конкретного Plugin. Корневой `package.json` перечисляет first-party Plugins
как состав дистрибутива, но production-модули `packages/core/` не импортируют их
напрямую.

Plugins доверенные и загружаются в процесс Orchestrator. Это не sandbox-модель.
Внешние программы запускаются только через ограниченный Core runner без shell.

## 2. Зафиксированные решения

1. Текущий пользовательский CLI сохраняется. Архитектурная миграция не является
   поводом переименовывать команды, аргументы, коды завершения или менять их
   предметное поведение.
2. Остаётся `commander`; `oclif` не добавляется.
3. Plugin — npm package с JavaScript entrypoint. `plugin.yaml -> argv -> execa`
   заменяется программным контрактом `definePlugin`.
4. Template и Plugins независимы. Template не объявляет, не устанавливает и не
   конфигурирует Plugins.
5. В Store выбран один Agent. Публичный `init --agent <id>` сохраняется. Переход от
   текущего массива `agents` к скалярному `agent` допускается только с версией
   project config и отдельной миграцией.
6. Plugin API v1 использует целое `apiVersion: 1` и строгое равенство. Диапазоны
   semver для API и зависимостей Plugin-to-Plugin не входят в первую версию.
7. Event hooks, `provide/use`, DI-container, общий `Plan/Step/rollback`, permissions,
   marketplace и выполнение недоверенного кода не входят в эту миграцию.
8. Cycle, Receipts и Snapshots принадлежат `plugin-change-tracking`. Core
   предоставляет только универсальное атомарное namespaced storage.
9. MCP-конфиг и инструкции устанавливает общий Agent Service. CodeGraph Plugin
   объявляет требуемый MCP server и текст инструкций, но не переносит форматы
   Codex/Qwen/Claude/GigaCode в Core-команды или Template.
10. `pacote` удаляется только одновременно с переходом на npm-backed Installer и
    после интеграционного теста реальной установки зависимостей.
11. Multi-repository topology является Core-функциональностью. Core владеет полным
    реестром Store и Code Repositories из `openspec-orch.yaml`, workspace,
    repository bindings и безопасным доступом к checkout. Change Tracking Plugin
    использует этот реестр для ведения конкретного Change, но не создаёт собственную
    модель мультирепозитория.
12. Порядок загрузки Plugins не является частью публичного контракта. Plugin не
    должен зависеть от того, что другой Plugin уже загружен или зарегистрирован
    раньше. Пока Plugins независимы, Loader не строит dependency graph и не выполняет
    топологическую сортировку.

## 3. Сохранение публичного интерфейса

| Команда | Владелец после миграции | Требование |
|---|---|---|
| `init`, `connect` | Core | Сигнатура и поведение не меняются |
| `repository status` | Core | Остаётся read-only |
| `plugin register/init/connect/status/sync/disconnect/remove` | Core Plugin Host | Сохраняется текущий UX с checkbox и `--from` |
| `assign`, `status`, `record assignment`, `verify`, `record verification` | bundled `plugin-change-tracking` | Монтируются в root CLI без изменения грамматики |
| `<plugin-id> --repository <id> ...` | соответствующий Plugin namespace | Сохраняется для пользовательских команд |

Только явно перечисленные first-party packages могут добавлять root-команды.
Пользовательские Plugins всегда получают собственный namespace, поэтому не могут
перехватить встроенную команду.

## 4. Граница Core

### 4.1. Что остаётся в Core

- поиск Store и чтение project config;
- доменные модели `Project`, `Store`, `Repository`, `Agent`, `PluginIdentity`;
- полный реестр Store и Code Repositories из `openspec-orch.yaml`;
- проверка repository IDs, roles, remotes, default branches и Plugin bindings;
- multi-repo workspace, подключение checkout и разрешение canonical repository roots;
- выбор repositories по ID/role и общий bounded-concurrency repository runner;
- `init`, `connect`, `repository status`;
- Git facade и OpenSpec facade;
- безопасный запуск процессов с заданным Core `cwd`, timeout и без shell;
- Plugin package installation, loading и command mounting;
- строгая проверка `apiVersion`, identity, entrypoint и конфликтов команд;
- один Agent Service с provider adapters;
- атомарное, блокируемое и namespaced локальное Plugin storage;
- логирование и единый перевод ошибок в CLI exit codes.

### 4.2. Multi-repo Core и Change Tracking

`openspec-orch.yaml` является конфигурацией мультирепозитория независимо от Plugins.
Repository существует в проекте даже при пустом `repositories[].plugins`. Core
всегда умеет найти его, подключить checkout, проверить Git identity и вернуть
доменный `Repository` handle.

Change Tracking не управляет репозиториями. Он добавляет поверх Core бизнес-модель:

```text
Core
  Project -> Store + Repository Registry + Workspace
                         |
                         | проверенные Repository handles
                         v
plugin-change-tracking
  Change -> Cycle -> Assignments -> Receipts -> Snapshot -> Verification
```

Core отвечает на вопрос: «какие repositories зарегистрированы и где находятся их
проверенные checkout». Plugin отвечает на вопрос: «какие из них участвуют в этом
Change, какие результаты получены и какой точный набор проверялся».

Mapping `change-id -> repository IDs`, `planning_revision`, текущие результаты и
история не переходят в Core. Это домен Change Tracking.

### 4.3. Что уходит из Core

В `@openspec-orch/plugin-change-tracking` переносятся:

- `src/internal/cycle/**`;
- `src/internal/receipt/**`;
- `src/internal/snapshot/**`;
- специфичные этим сущностям state-схемы;
- CLI handlers `assign`, `status`, `record assignment`, `verify`,
  `record verification`;
- форматирование и error codes, принадлежащие этим операциям.

В `@openspec-orch/plugin-codegraph` остаются:

- зависимость `@colbymchenry/codegraph`;
- launcher этой зависимости;
- repository lifecycle CodeGraph;
- MCP server declaration и CodeGraph instructions;
- CodeGraph-specific ошибки и тесты.

Core не должен содержать условие по `pluginId` для обоих first-party Plugins.

## 5. Структура пакетов

Целевая структура:

```text
packages/
  core/
    package.json
    index.js
    lib/
      agent/
      config/
      git/
      openspec/
      plugin/
      repository/
      shared/
  plugin-sdk/
    package.json
    index.js
    testing.js
    README.md

plugins/
  change-tracking/
    package.json
    index.js
    lib/
    test/
  codegraph/
    package.json
    index.js
    lib/
    bin/
    test/

bin/
  openspec-orch.js
```

Существующий `src/` не является частью целевой структуры. Он временно остаётся рядом
как legacy implementation и исполняемый oracle до parity-проверки и переключения
root `bin` entrypoint, после чего удаляется целиком.

Root npm workspaces включают `packages/*` и `plugins/*`. Зависимости направлены
только так:

```text
plugins/*          -> plugin-sdk
packages/core      -> plugin-sdk contract types
root distribution -> Core + bundled plugins
```

`plugin-sdk` не импортирует Core. Один Plugin не импортирует другой Plugin.

### 5.1. Механическая защита границ

Направление зависимостей проверяется не только на ревью:

1. Scoped `no-restricted-imports` в текущем ESLint flat config запрещает статические
   импорты `packages/core/**` и legacy `src/internal/**` из `plugins/**`.
2. Зеркальное правило запрещает `packages/core/**` импортировать `plugins/**` и
   конкретные first-party Plugin packages. `@openspec-orch/plugin-sdk` остаётся
   разрешённым публичным контрактом.
3. Root `package.json` остаётся декларативным composition root через
   `openspecOrchestrator.bundledPlugins`; отдельное исключение для JavaScript import
   не требуется.
4. `package.json#exports` каждого package открывает только публичные entrypoints и
   не экспортирует внутренние модули.
5. Boundary test дополнительно ищет запрещённые dynamic `import()`, `createRequire()`
   и относительные ссылки, которые не покрывает `no-restricted-imports`.

Целевые scoped rules концептуально выглядят так:

```js
{
  files: ["plugins/**/*.js"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/packages/core/**", "**/src/internal/**"],
        message: "Plugin может использовать только @openspec-orch/plugin-sdk"
      }]
    }]
  }
},
{
  files: ["packages/core/**/*.js"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/plugins/**"],
        message: "Core не импортирует конкретные Plugins"
      }]
    }]
  }
}
```

При реализации точные glob patterns проверяются отдельными положительными и
отрицательными ESLint fixtures, а не принимаются только по внешнему виду config.

## 6. Минимальный Plugin SDK v1

### 6.1. Package metadata

Отдельный `plugin.yaml` удаляется. Transport metadata остаются в `package.json`:

```json
{
  "name": "@company/openspec-orch-plugin-demo",
  "version": "1.0.0",
  "type": "module",
  "exports": "./index.js",
  "openspecOrchestrator": {
    "apiVersion": 1,
    "plugin": "./index.js"
  },
  "peerDependencies": {
    "@openspec-orch/plugin-sdk": "^1.0.0"
  }
}
```

Package name/version принадлежат npm package. Plugin ID и capabilities принадлежат
программному контракту; дублировать lifecycle в YAML не нужно.

### 6.2. Entrypoint

Минимальный пользовательский Plugin состоит из одного entrypoint:

```js
import { definePlugin } from "@openspec-orch/plugin-sdk";

export default definePlugin({
  id: "demo",
  supports: ["code"],

  repository: {
    async connect(context) {},
    async status(context) {
      return { state: "ready", details: "demo is ready" };
    },
    async sync(context) {},
  },

  registerCommands(commands) {
    commands.command("hello")
      .description("Demo command")
      .action(async () => {});
  },
});
```

`definePlugin` не создаёт container и не выполняет код. Он нормализует и замораживает
plain object, а Core Loader независимо валидирует экспорт до регистрации команд.
Проверка не должна зависеть от `instanceof`, чтобы разные физические копии SDK не
ломали загрузку.

SDK README содержит явную гарантию:

> Порядок загрузки Plugins не специфицирован. Plugin не должен полагаться на то, что
> другой Plugin загружен или зарегистрирован раньше.

Это текстовое правило сохраняет возможность добавить dependency graph и топологическую
сортировку позже как аддитивную возможность, если появится подтверждённый сценарий.

### 6.3. PluginContext

Core создаёт новый immutable context на invocation. Минимальный контракт:

```js
{
  project: {
    id,
    strict,
    store,
    repositories,
    agent
  },
  repositories,
  repository,
  git,
  openspec,
  files,
  process,
  storage,
  agent,
  logger
}
```

Правила сервисов:

- `repositories` читает Core registry и возвращает только проверенные domain handles;
- `repository` задан только для repository-scoped invocation;
- `repositories.requireConnected(ids)` проверяет, что текущий Plugin связан с каждым
  выбранным Repository в `openspec-orch.yaml`;
- `git` принимает `Repository`, а не произвольный `cwd`;
- `files.forRepository(repository)` читает и атомарно пишет только безопасные
  относительные пути внутри canonical repository root;
- `process.run(repository, executable, args, options)` всегда подставляет canonical
  repository root, не использует shell и применяет Core timeout;
- `storage` доступен только в namespace текущего Plugin;
- `agent` представляет единственный Agent проекта и не даёт Plugin произвольный
  доступ к чужим provider configs;
- `logger` автоматически добавляет Plugin ID и Repository ID;
- context не содержит внутренних путей `packages/core`, legacy `src/` и изменяемый
  `ProjectModel`.

Git/OpenSpec facades сначала включают только методы, реально нужные двум Plugins.
Новый метод добавляется по тестируемому use case, а не заранее.

### 6.4. Command contribution

Core передаёт Plugin ограниченный command root:

- пользовательский Plugin получает namespace `openspec-orch <plugin-id>`;
- `plugin-change-tracking` получает root только потому, что root distribution явно
  разрешает ему согласованные команды;
- duplicate command/path блокирует запуск до выполнения action;
- Plugin action получает context через Core factory, а не собирает Store и
  Repository самостоятельно.

Первая версия может оборачивать Commander `Command`, но публичный SDK экспортирует
только `CommandRegistry` JSDoc type. Plugin не должен импортировать внутренние CLI
handlers Core.

### 6.5. Project registration и Repository bindings

Установка Plugin и разрешение работать с Repository — разные состояния:

```text
Package доступен
    -> plugin init
Plugin зарегистрирован в Project
    -> plugin connect --repo <id>
Plugin связан с конкретным Repository
```

Верхнеуровневый `plugins` фиксирует package и делает его команды доступными.
`repositories[].plugins` является проверяемым access binding: Plugin может получить
repository root, Git facade или file facade только для связанного Repository.

```yaml
plugins:
  - id: change-tracking
    source: "@openspec-orch/plugin-change-tracking@1.0.0"
  - id: codegraph
    source: "@openspec-orch/plugin-codegraph@1.0.0"

repositories:
  - id: specs
    role: store
    plugins: [change-tracking, codegraph]
  - id: frontend
    role: code
    plugins: [change-tracking, codegraph]
  - id: backend
    role: code
    plugins: [change-tracking]
  - id: documentation
    role: code
    plugins: [codegraph]
```

В этом примере Core управляет всеми четырьмя repositories. Отсутствие
`change-tracking` у `documentation` не исключает Repository из мультирепозитория, а
только запрещает этому Plugin использовать его. CodeGraph и Change Tracking могут
иметь разные наборы bindings.

Для Change Tracking обязательны:

- binding к единственному Store, потому что Plugin читает и пишет Cycle Records;
- binding к каждому Code Repository, который разрешено включать в Change;
- дополнительный выбор `--repo` в `assign`, определяющий фактический состав одного
  Change внутри разрешённого набора.

Пример выполнения:

```text
openspec-orch assign checkout-flow --repo frontend --repo backend
  -> Plugin Host вызывает plugin-change-tracking
  -> Core requireConnected([frontend, backend])
  -> Core проверяет registry, checkout и YAML bindings
  -> Plugin создаёт Cycle и Change-specific assignments
```

Попытка передать `documentation` завершается `PLUGIN_NOT_CONNECTED` до изменения
Cycle или state. Plugin не читает YAML, не строит filesystem paths и не клонирует
repositories самостоятельно.

`plugin disconnect` блокирует новые операции Plugin над Repository, но не удаляет
исторические Cycle/Receipt/Snapshot. Read-only status продолжает показывать историю
с признаком `disconnected`; продолжение записи требует повторного connect.

## 7. Agent Service и MCP

В проекте активен один Agent. Provider adapter Core знает, где и как обновить
конфигурацию выбранного Agent; Plugin объявляет только интеграцию:

```js
agent: {
  integration(context) {
    return {
      mcpServers: {
        codegraph: {
          command: process.execPath,
          args: [context.plugin.resolve("bin/codegraph.js"), "serve", "--mcp"]
        }
      },
      instructions: "..."
    };
  }
}
```

Требуемое поведение:

1. `init --agent <id>` сохраняет единственный Agent ID.
2. `plugin init` после успешной установки вызывает Agent Service для Plugin с Agent
   contribution.
3. Операция идемпотентно устанавливает MCP и marker-fenced instructions.
4. `plugin remove` удаляет только записи и инструкции этого Plugin.
5. Остальной пользовательский config и чужие MCP servers сохраняются.
6. Неизвестный Agent блокирует только установку требующей его интеграции, не оставляя
   наполовину зарегистрированный Plugin.

`@modelcontextprotocol/sdk` не добавляется: CodeGraph уже поставляет готовый MCP
server. Пакет понадобится только если Orchestrator начнёт реализовывать собственный
MCP server или proxy.

## 8. npm-backed Plugin Installer и удаление pacote

### 8.1. Текущее фактическое поведение

Текущий `catalog.js` использует `pacote.extract` для discovery и materialization,
а затем запускает `npm install --omit=dev --ignore-scripts` при наличии production
dependencies. Поэтому проблема не в полном отсутствии установки dependencies.

Недостатки текущей схемы:

- один source может распаковываться дважды;
- получение artifact и построение dependency tree разделены между двумя механизмами;
- Git/directory fetch имеет prepare-семантику `pacote`;
- тест проверяет аргументы подменённого installer, но не реальное разрешение
  транзитивной зависимости;
- source identity и полный resolved dependency tree не зафиксированы как переносимый
  project lock.

### 8.2. Источники Plugin

Installer поддерживает только явные источники:

- bundled package из root distribution;
- точный npm spec `name@version`;
- `.tgz` или tarball URL с сохранённой integrity;
- Git URL только с commit SHA;
- локальный package directory только в development-режиме через существующий
  `plugin init --from <path>`.

Tags, плавающие ranges и Git default branch не записываются как воспроизводимая
установка. Их можно принять как пользовательский ввод только если Installer сначала
разрешит и сохранит точную версию/commit/integrity.

### 8.3. Файлы установки

Portable declaration хранится в версионированном project config, отдельно от
repository bindings:

```yaml
plugins:
  - id: codegraph
    source: "@openspec-orch/plugin-codegraph@1.0.0"

repositories:
  - id: frontend
    plugins: [codegraph]
```

Переход от текущего `plugins: [id]` выполняется только через новую версию config.
Generated `openspec-orch.plugins-lock.json` фиксирует resolved artifact, integrity и
dependency tree и коммитится вместе с `openspec-orch.yaml`. Абсолютные локальные пути
в оба файла не записываются.

Development override хранится только локально в gitignored
`.openspec-orch/local-plugins.json` и создаётся существующей командой
`plugin init --from <path> --plugin <id>`. В portable project config такой Plugin
фиксируется с `source: local`, без абсолютного пути; на другой машине он честно имеет
статус `unavailable`, пока пользователь явно не передаст локальный package source.
`plugin register` по-прежнему только создаёт исходный package и не подключает его
неявно.

### 8.4. Алгоритм установки

Для внешнего package:

1. захватить Store-local installer lock;
2. создать временный каталог рядом с конечным cache target;
3. создать минимальный runtime `package.json` с точной версией Plugin SDK;
4. выполнить через `execa` без shell:

   ```text
   npm install --prefix <temp-runtime> --save-exact --omit=dev
     --ignore-scripts --no-audit --no-fund <exact-package-spec>
   ```

5. для локального directory использовать явный `--install-links`, чтобы npm
   materialize package, а не оставил внешний symlink;
6. найти установленный package, запретить symlink entrypoint и импортировать его;
7. проверить package identity, `apiVersion`, Plugin ID, supports и command conflicts;
8. записать installation receipt и lock projection;
9. атомарно активировать каталог rename-операцией;
10. только после успешной активации обновить project config;
11. при любой ошибке удалить temp и оставить предыдущую установку/config без
    изменений.

Bundled Plugin не переустанавливается в Store: Loader разрешает его из dependency
root distribution и проверяет name/version.

Lifecycle scripts остаются запрещены. Plugin с зависимостью, требующей install или
postinstall, должен поставлять готовый artifact либо быть bundled и проходить сборку
на этапе выпуска Orchestrator.

### 8.5. Момент удаления pacote

`pacote` удаляется из imports, `package.json` и lockfile только когда одновременно:

- npm-backed Installer покрывает все поддерживаемые source kinds;
- реальный fixture Plugin импортирует собственную транзитивную dependency;
- lifecycle-script fixture не создаёт sentinel file;
- invalid entrypoint/package не меняет предыдущую установку и project config;
- bundled CodeGraph проходит E2E;
- `plugin init --from`, checkbox flow и повторный init сохраняют текущее поведение.

Не заменять `pacote` прямым использованием Arborist: это низкоуровневая внутренняя
модель npm и она увеличит собственный код. npm CLI является единственным installer
boundary.

## 9. Namespaced Plugin Storage

Core оставляет универсальные операции `read`, `write` и `update` с атомарной записью
и межпроцессным lock. Физическое размещение:

```text
.openspec-orch/
  state.json                         # только Core: workspace и Core metadata
  plugins/
    change-tracking/state.json        # Receipts, Snapshots, history
    <plugin-id>/state.json           # state конкретного Plugin
```

Core проверяет envelope и schema version, но содержимое `data` валидирует Plugin:

```json
{
  "storage_version": 1,
  "plugin_id": "change-tracking",
  "data": {}
}
```

Plugin не получает путь к storage и не может открыть namespace другого Plugin через
SDK. `update` выполняет read-check-write под одним lock. Повреждённый JSON или
неподдерживаемая версия остаются fail-closed.

Миграция текущего смешанного `state.json` идемпотентна:

1. прочитать и полностью проверить старый state;
2. записать и проверить `plugins/change-tracking/state.json`;
3. записать Core state только с workspace;
4. пометить migration version;
5. при прерывании повторить шаги, сравнивая уже записанные данные;
6. не удалять единственную корректную копию до успешной проверки обеих новых.

## 10. Пакеты и зависимости

### 10.1. Оставить

- `commander` — CLI и command contributions;
- `zod` — Core/file/runtime validation;
- `execa` — npm, Git и внешние binaries без shell;
- `p-map` — ограниченная конкурентность по repositories;
- `@inquirer/prompts` — checkbox и подтверждения;
- `ora` — простой последовательный progress;
- `yaml` — `openspec-orch.yaml`, Store metadata и `template.yaml`.

### 10.2. Добавить на конкретном этапе

- `@openspec-orch/plugin-sdk` — workspace package на этапе SDK;
- `@openspec-orch/plugin-change-tracking` — bundled package после переноса домена;
- `typescript` как devDependency — только после появления SDK, для
  `checkJs/noEmit` и генерации `.d.ts` из JavaScript/JSDoc;
- `publint` и `@changesets/cli` — только перед первой публикацией нескольких
  самостоятельных packages.

### 10.3. Не добавлять в эту миграцию

- `hookable`, `tapable` — event hooks отсутствуют;
- `semver` — Plugin API сравнивается как целая major version;
- `write-file-atomic` — текущий atomic rename helper достаточен до подтверждённого
  дефекта;
- `proper-lockfile` — текущая fail-closed lock-семантика сохраняется; пакет нужен
  только при доказанной потребности в stale-lock recovery;
- `listr2` — нет общего параллельного Executor;
- `@modelcontextprotocol/sdk` — готовый CodeGraph MCP уже существует;
- `smol-toml` — marker-fenced обновление сохраняет чужие комментарии и форматирование;
- `simple-git`, DI containers, oclif, vitest и сборщики TypeScript.

## 11. Стратегия и этапы реализации

### 11.1. Способ миграции: параллельная сборка и cutover

Новая система строится рядом с legacy `src/`, сразу в финальных каталогах. Не
создавать временные `src-new`, `src-v2` или вторую копию репозитория: они добавят ещё
один перенос и позволят временным импортам стать постоянными.

Во время миграции одновременно существуют два полностью различимых entrypoint:

```text
public/legacy:  node src/bin/openspec-orch.js
candidate/new:  node bin/openspec-orch.js
```

До cutover root `package.json#bin` продолжает указывать на legacy entrypoint. Новый
CLI запускается только напрямую из тестов и локальных smoke-команд. Runtime feature
flag в продукт не добавляется.

Legacy `src/` используется как исполняемый oracle, но не как зависимость новой
архитектуры:

- `packages/core` и `plugins/*` не импортируют legacy modules;
- новые возможности в legacy runtime не добавляются;
- переносимые чистые функции и доменные модули сначала копируются механически с
  сохранением tests/fixtures;
- изменение поведения и рефакторинг выполняются отдельным следующим коммитом;
- shared fixture может использоваться обоими entrypoints, но их runtime state и
  временные Git repositories всегда разделены.

Переключение выполняется изменением одного публичного маршрута:

```json
{
  "bin": {
    "openspec-orch": "./bin/openspec-orch.js"
  }
}
```

Старый `src/` удаляется не в cutover-коммите, а только после повторной проверки уже
переключённого package. Это оставляет простую Git-точку возврата без runtime-флага.

### 11.2. Исходная проверка без отдельного этапа

Не создавать отдельный набор legacy oracle fixtures и не выделять для него коммит.
Текущие тесты, публичный CLI и форматы файлов используются как исходный контракт.
Недостающий regression test добавляется только на том этапе переноса, где обнаружен
конкретный непокрытый риск. Перед созданием workspace skeleton достаточно убедиться,
что существующий `npm run check` зелёный.

### 11.3. Этап 1. Создать финальный workspace skeleton

- добавить `packages/core`, `packages/plugin-sdk` и root `bin/`;
- включить `packages/*` и `plugins/*` в npm workspaces;
- создать package manifests и минимальные закрытые `exports`;
- добавить новый непубличный `bin/openspec-orch.js`;
- оставить `package.json#bin` на `src/bin/openspec-orch.js`;
- включить scoped ESLint boundaries до переноса production-кода.

Критерий выхода: оба entrypoint однозначно запускаются, но публичным остаётся только
legacy; новые packages не импортируют `src/internal`.

### 11.4. Этап 2. Plugin SDK без production runtime

- реализовать `definePlugin` и JSDoc types;
- определить `PluginDefinition`, `PluginContext` и `CommandRegistry`;
- добавить contract test kit для manifest, lifecycle и command registration;
- зафиксировать в SDK README неспецифицированный порядок загрузки;
- проверить package exports и отсутствие зависимости SDK от Core;
- не подключать SDK к legacy production loader.

Критерий выхода: независимый sample Plugin проходит SDK test kit и импортирует
только `@openspec-orch/plugin-sdk`.

### 11.5. Этап 3. Перенести универсальный Core

- механически перенести Project, Store и Repository domain models;
- перенести чтение/проверку `openspec-orch.yaml` и Store metadata;
- перенести workspace resolution и Repository checkout resolution;
- перенести Git, OpenSpec, Files и Process facades;
- перенести atomic write и fail-closed lock primitives;
- реализовать namespaced Plugin Storage;
- перенести `init`, `connect` и `repository status` без изменения поведения;
- добавить общий repository selector и bounded-concurrency runner;
- не переносить Cycle, Receipt, Snapshot или CodeGraph knowledge.

Критерий выхода: candidate CLI проходит Core characterization tests и даёт те же
результаты `init/connect/repository status`, не импортируя legacy `src/`.

### 11.6. Этап 4. Новый Loader, Host и PluginContext

- реализовать динамический ESM import проверенного entrypoint;
- независимо валидировать plain Plugin export;
- создать immutable context factory и Core facades;
- реализовать Repository binding checks до Plugin callback;
- добавить command mounting, reserved root policy и conflict detection;
- сделать Loader fail-fast до запуска Plugin action;
- проверить независимость registry от порядка загрузки Plugins;
- не добавлять dependency graph, topological sort, hooks или `provide/use`.

Критерий выхода: sample Plugin выполняет repository lifecycle и namespaced command
через candidate CLI; Core не содержит условия по его Plugin ID.

### 11.7. Этап 5. npm-backed Installer

- реализовать временный runtime, npm install и atomic activation;
- добавить portable source declaration и generated Plugin lock;
- реализовать local development override через текущий `plugin init --from`;
- переключить candidate `plugin init/remove/status` на новый installation record;
- проверить npm, tarball, Git commit, bundled и local source;
- доказать реальную установку транзитивной dependency;
- доказать запрет lifecycle scripts;
- удалить `pacote` из candidate dependencies только после критериев раздела 8.5;
- legacy runtime до cutover не менять ради этого удаления.

Критерий выхода: внешний Plugin устанавливается и импортируется candidate CLI на
чистой машине без ручного `npm install` в его каталоге.

### 11.8. Этап 6. Перенести plugin-change-tracking

- создать bundled `@openspec-orch/plugin-change-tracking`;
- механически перенести Cycle/Receipt/Snapshot domain и CLI handlers;
- сохранить форматы файлов, ID/hash algorithms, CLI arguments и error codes;
- оставить repository registry, workspace, config bindings и repository runner в
  Core;
- получать Store и Code Repositories только через PluginContext;
- перенести локальный state в namespace с идемпотентной миграцией;
- смонтировать согласованные root-команды через composition root;
- не удалять исходные legacy modules на этом этапе.

Критерий выхода: candidate pilot flow даёт те же records, hashes, ошибки и вывод,
что legacy flow на независимой копии одинаковых fixtures.

### 11.9. Этап 7. Перенести plugin-codegraph и Agent Service

- заменить `plugin.yaml` программным entrypoint;
- сохранить CodeGraph dependency и launcher внутри Plugin package;
- представить `init/status/sync` как repository lifecycle;
- представить MCP и instructions как Agent contribution;
- реализовать общий Core Agent Service для единственного выбранного Agent;
- сохранить чужие MCP entries, инструкции и форматирование конфигов;
- проверить Store и все связанные Code Repositories;
- не удалять legacy CodeGraph runtime до общего cutover.

Критерий выхода: candidate CLI устанавливает bundled CodeGraph checkbox-ом,
связывает его с repositories, запускает реальный binary, а выбранный при `init`
Agent получает рабочий MCP.

### 11.10. Этап 8. Scaffold и третий Plugin

- обновить candidate `plugin register`: создавать `package.json`, `index.js`, README
  и contract test;
- не создавать `plugin.yaml` и executable без необходимости;
- пройти `register -> plugin init --from -> connect -> status -> command`;
- создать третий fixture Plugin, отличный от Change Tracking и CodeGraph;
- подтвердить отсутствие изменений `packages/core`, Template и Loader;
- проверить ESLint, package exports и boundary tests на этом Plugin.

Критерий выхода: сторонний Plugin полностью реализуется внутри созданного каталога и
работает через публичный SDK.

### 11.11. Этап 9. Parity и isolated E2E двух entrypoints

Для одинаковых входных fixtures отдельно запустить legacy и candidate:

```text
legacy    -> temp/legacy-store + temp/legacy-workspace
candidate -> temp/new-store    + temp/new-workspace
```

Сравнить:

- command grammar, help, exit code, stdout и stderr;
- generated YAML/JSON и project config migration;
- Cycle Records, Receipts и Snapshot IDs;
- repository bindings и Git state;
- Plugin installation/status/remove;
- CodeGraph repository lifecycle;
- Agent MCP configs и instructions;
- повторный запуск после restart;
- отсутствие частичных записей после каждого негативного сценария.

Mutating flows никогда не запускаются двумя реализациями над одним Store. Допустимы
только независимые копии одних исходных Git fixtures.

Критерий выхода: все допустимые различия перечислены и отдельно согласованы; скрытых
расхождений поведения нет, полный candidate isolated E2E зелёный.

### 11.12. Этап 10. Cutover публичного entrypoint

- изменить root `package.json#bin` на `./bin/openspec-orch.js`;
- обновить `files`, workspaces и bundled dependencies дистрибутива;
- не удалять legacy `src/` в этом коммите;
- выполнить `npm run check`, coverage и все package tests;
- выполнить `npm pack --dry-run` и проверить точный состав tarball;
- установить собранный tarball в чистое временное окружение;
- повторить полный isolated E2E через опубликованный bin path;
- проверить Node engine guard и запуск без workspace hoisting.

Критерий выхода: root package и установленный tarball используют только новый
entrypoint; legacy остаётся лишь невызванной точкой безопасного отката.

### 11.13. Этап 11. Удалить legacy src

- отдельным коммитом удалить весь старый `src/`;
- удалить legacy-only tests, constants, schemas и dependencies;
- удалить `pacote`, старый descriptor parser, argv model, process client и router,
  если они ещё остались только ради legacy;
- проверить отсутствие импортов и строковых ссылок на `src/`;
- обновить актуальную документацию после фактического удаления;
- повторить lint, tests, coverage, package dry-run, tarball install и isolated E2E;
- выполнить `git diff --check` и итоговое ревью dependency graph.

Критерий выхода: repository содержит только новый Core/SDK/Plugins, публичный CLI не
изменил согласованное поведение, а удалённый legacy не требуется ни одному test или
package artifact.

## 12. Обязательная матрица проверок

### Контракт SDK и Loader

- unsupported `apiVersion` отклоняется до command action;
- default export отсутствует или имеет неверную форму;
- duplicate Plugin ID и duplicate command path отклоняются;
- custom Plugin не может занять root command;
- Plugin импортирует только SDK/public facades, не `packages/core` или legacy
  `src/internal`;
- два независимых Plugins дают одинаковый registry при разном порядке загрузки;
- Plugin, полагающийся на уже загруженный другой Plugin, не считается совместимым с
  SDK contract;
- ошибка загрузки одного обязательного Plugin не оставляет частичный registry.

### Installer

- bundled, exact npm, tarball, Git commit и local development source;
- транзитивная production dependency реально импортируется;
- devDependency не устанавливается;
- lifecycle scripts не выполняются;
- local directory не оставляет symlink в materialized runtime;
- identity/version/integrity mismatch блокирует активацию;
- повторная установка идемпотентна;
- ошибка обновления оставляет предыдущую версию рабочей;
- параллельные install/remove не повреждают cache или config.

### Project и Repository bindings

- Repository без Plugins остаётся полноправной частью Core multi-repo registry;
- несколько Plugins подключаются к одному Repository;
- один Plugin подключается к нескольким repositories;
- Change Tracking принимает в `assign` только связанные Code Repositories;
- Change Tracking требует Store binding для операций записи Cycle;
- Plugin не читает `openspec-orch.yaml` и не разрешает checkout path самостоятельно;
- unsupported repository role блокируется до Plugin callback;
- config записывается только после успешного connect;
- disconnect/remove не удаляют чужие данные;
- status имеет стабильный порядок при конкурентном чтении.

### Agent и MCP

- используется ровно Agent, выбранный через `init --agent`;
- install/remove идемпотентны;
- существующие MCP entries и инструкции сохраняются;
- повреждённый config не перезаписывается;
- CodeGraph launcher использует установленную package dependency;
- после `plugin init codegraph` реальный Agent видит MCP tool.

### Parity plugin-change-tracking

- все текущие Cycle/Receipt/Snapshot unit tests перенесены без ослабления assertions;
- hashes и сериализованные records совпадают с baseline fixtures;
- текущие negative scenarios и stable error codes сохраняются;
- полный изолированный Store/frontend/backend pilot flow проходит без изменения
  пользовательских команд.

### Архитектурные boundary tests

- после финального cutover legacy `src/` отсутствует;
- `packages/core/` не содержит `codegraph`, Cycle, Receipt или Snapshot domain;
- `packages/core/` не импортирует first-party Plugin packages;
- ESLint отклоняет статический импорт `packages/core/**` или legacy
  `src/internal/**` из `plugins/**`;
- ESLint отклоняет статический импорт `plugins/**` из `packages/core/**`;
- boundary test отклоняет запрещённые dynamic imports и `createRequire()`;
- package exports не открывают приватные Core и Plugin modules;
- один Plugin не импортирует другой Plugin и не зависит от порядка загрузки;
- `templates/` не объявляет и не устанавливает Plugins;
- новый fixture Plugin не требует изменения списка Core handlers или ветки по ID;
- dependency graph packages не содержит циклов.

## 13. Definition of Done

Миграция завершена только когда одновременно выполнено:

1. Все текущие пользовательские команды работают с прежней грамматикой.
2. `plugin-change-tracking` и `plugin-codegraph` используют один публичный SDK и
   один Host.
3. Третий Plugin создан `plugin register`, подключён и запущен без изменения
   `packages/core` и `templates/`.
4. CodeGraph поставляется вместе с Orchestrator и не требует ручной установки своих
   npm dependencies.
5. MCP и инструкции установлены для единственного Agent, выбранного при `init`.
6. `pacote`, `plugin.yaml` и старый argv runtime полностью удалены.
7. Project config и Plugin lock воспроизводят одну и ту же версию Plugin на другой
   машине и в CI.
8. State migration идемпотентна и не теряет workspace, Receipts или Snapshots.
9. `npm run check`, coverage, package dry-runs и реальный isolated E2E зелёные.
10. `git diff --check` чист, а итоговый diff не меняет предметную реализацию Cycle,
    Snapshot или CodeGraph.
11. ESLint и boundary tests механически блокируют импорты между Core internals и
    конкретными Plugins; SDK README явно объявляет порядок загрузки
    неспецифицированным.
12. Root `package.json#bin` указывает на новый composition root, установленный
    tarball проходит isolated E2E, а legacy `src/` полностью удалён из repository и
    package artifact.

## 14. Порядок ревью и коммитов

Не выполнять миграцию одним большим diff. Предпочтительная серия:

1. финальный workspace skeleton и непубличный candidate entrypoint;
2. SDK package;
3. механический перенос универсального Core;
4. Loader, Host и PluginContext;
5. npm-backed Installer для candidate runtime;
6. `plugin-change-tracking` parity move;
7. `plugin-codegraph` parity move и Agent Service;
8. scaffold и третий Plugin;
9. parity suite двух entrypoints;
10. cutover root `package.json#bin` без удаления legacy;
11. отдельное удаление `src/`, legacy dependencies и финальный package E2E.

Каждый коммит должен быть самостоятельно проверяемым. Перенос доменного кода сначала
делается механически, а рефакторинг — отдельным следующим коммитом, чтобы ревью могло
отличить изменение владельца от изменения поведения.
