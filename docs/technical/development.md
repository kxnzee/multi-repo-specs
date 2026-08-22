# Разработка Orchestrator Core

Этот документ описывает границы исходного кода и минимальные проверки для
разработчиков Orchestrator. Пользователям CLI он не нужен.

## Границы кода

- `src/internal/shared/cli-grammar.js` — единый registry top-level tokens публичного CLI;
- `src/cli/program.js` — сборка публичной грамматики CLI из общего registry;
- `src/cli/commands/` — интерактивные пользовательские сценарии и вывод;
- `src/internal/cycle/` — Cycle Record и `status`;
- `src/internal/receipt/`, `snapshot/`, `state/` — локальные результаты и Snapshot;
- `src/internal/init/`, `connect/`, `config/` — bootstrap и реестр репозиториев;
- `src/internal/config/project.js` — общий доменный facade Repository и Plugin operations;
- `src/internal/config/plugin.js` — project-config contract Plugin IDs и Repository bindings;
- `src/internal/config/settings.js` — единая точка эксплуатационных defaults Core;
- `src/internal/config/constants.js` — версии контрактов, regex и служебные пути;
- `src/internal/plugin/catalog.js` — discovery, проверка и локальный cache Plugin packages;
- `src/internal/plugin/contract.js` — внешний контракт Plugin descriptor;
- `src/internal/plugin/runtime.js` — generic разрешение Package entrypoint без ветвлений по Plugin ID;
- `src/internal/plugin/model.js` — доменная модель scope и lifecycle одного Plugin;
- `src/internal/plugin/plugin-client.js` — низкоуровневое выполнение готового invocation, аналогично `git-client.js`;
- `src/internal/plugin/project.js` — project selection, repository bindings и lifecycle;
- `src/internal/plugin/router.js` — нативный namespace `openspec-orch <plugin-id> ...` до Commander parsing;
- `src/internal/plugin/scaffold.js` — универсальная генерация самостоятельного Plugin Package;
- `src/internal/plugin/index.js` — единственный production facade Plugin subsystem;
- `src/internal/shared/openspec-model.js` — чистая модель JSON contract, diagnostics и identity OpenSpec;
- `src/internal/shared/openspec-client.js` — единственная граница запуска внешнего OpenSpec CLI;
- `src/internal/shared/` — Git, OpenSpec, filesystem и process-примитивы;
- `templates/base/` — Project Template, используемый только при `init`;
- `plugins/*` — самостоятельные npm workspace-пакеты стандартной поставки; dependencies
  конкретного инструмента принадлежат его пакету, а не Core;
- `test/` — unit- и интеграционные проверки на временных Git-репозиториях.

Публичного JavaScript API нет: поддерживаемая поверхность — CLI `openspec-orch`.

Корневой `package.json` собирает стандартную поставку через
`openspecOrchestrator.bundledPlugins`. Каждый элемент является отдельной dependency и
содержит `package.json`, `plugin.yaml` и необязательный Node entrypoint. Сторонний
Package может поступить из каталога, tarball, Git или npm registry; загрузка выполняется
через `pacote`, а production dependencies устанавливаются без lifecycle scripts.
`openspec-orch plugin register <plugin-id> [path]` создаёт весь authoring contract
в отдельном каталоге. Добавление нового Plugin не требует файла, класса или ветки по
его ID внутри `src/`.

Plugin CLI запускается существующим `execa`-адаптером без shell. Для batch
`connect` и `status` используется `p-map` с лимитом из `config/settings.js`:
это сохраняет порядок результата и не создаёт неограниченный fan-out на проектах с
сотнями repositories. `connect` записывает все новые bindings в config один раз
после успешного batch setup.

`config/settings.js` содержит централизованные изменяемые defaults: command timeout,
project strict default, каталог Code Repositories, Plugin concurrency и параметры
OpenSpec init. Их изменение считается изменением project policy и может влиять на
создаваемый config, layout или эксплуатационное поведение.
Статические версии схем, regex и служебные пути собраны отдельно в
`config/constants.js`; YAML-поля и CLI grammar остаются частью своих контрактов.

`readStoreConfiguration()` возвращает только Store metadata и `ProjectModel`.
Repository lookup, Plugin filters, bindings и legacy migration guard не читают
нормализованные массивы config в обход доменного facade. `ProjectModel` владеет
immutable snapshot конфигурации: его getters и persistence DTO нельзя изменить
в обход доменных методов.

OpenSpec use cases создают `OpenSpecClient`, привязанный к конкретному `cwd`, и
передают его сырой вывод функциям `openspec-model.js`. Domain model не запускает
процессы, а Client не разбирает JSON и не принимает решений об identity.

## Добавление агента

Поддержка нового агента добавляется без изменения Core:

- добавьте mapping в `templates/base/template.yaml`;
- копируйте совместимые канонические файлы напрямую, а несовместимые адаптируйте в
  `templates/base/adapters/<agent-id>/`;
- обновите только `docs/user/supported-agents.md` и универсальные тесты Template,
  не добавляя отдельный реестр или тестовые ветвления по agent id;
- проверьте `openspec-orch init` и обнаружение instructions, project skill и
  subagent в нативном runtime. Если runtime недоступен, не объявляйте поддержку
  проверенной.

## Проверки

```bash
npm run check
git diff --check
node src/bin/openspec-orch.js --help
```

До завершения пилота правила заморозки Core определены в `AGENTS.md`, а
кандидаты развития записываются в `BACKLOG.md`.
