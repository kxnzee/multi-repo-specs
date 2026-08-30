# CodeGraph Plugin Package

Пакет `@colbymchenry/codegraph` создаёт локальный семантический граф кода и
предоставляет его агенту через CLI и MCP. Orchestrator поставляет отдельный CodeGraph
Plugin; он не связан с Project Template.

## Граница ответственности

- Один binding Store или Code Repository — один локальный каталог `.codegraph/` в
  соответствующем Git checkout.
- `.codegraph/` является производным индексом и не коммитится в Git.
- Центральный OpenSpec Store не хранит копии графов Code Repositories.
- Requirements и целевое наблюдаемое поведение определяются только OpenSpec Store.
  Code Repository предоставляет current-state evidence, а CodeGraph ускоряет
  навигацию внутри уже выбранного Repository; ни код, ни граф кода не создают
  Requirement и не расширяют scope Change.
- Отсутствующий или неисправный CodeGraph не блокирует OpenSpec workflow: агент
  возвращается к адресному read/search.

## Подготовка через Orchestrator

CodeGraph поставляется самостоятельным Plugin Package
`@openspec-orch/plugin-codegraph`, который владеет подходящим для текущей платформы
runtime. Core зависит только от Plugin Package и ничего не знает о внутренней
зависимости CodeGraph. Отдельно устанавливать executable и добавлять его в `PATH`
не нужно. Выберите Plugin и свяжите его с Repository:

```bash
cd <абсолютный путь до Store>
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin status --plugin codegraph --repo frontend
openspec-orch plugin exec codegraph --repo frontend -- explore "authentication flow"
```

Plugin поддерживает Store и Code Repository. Каждый binding изолирован своим cwd,
локальным индексом и Repository-scoped Extension; Store binding не открывает checkout
другого Repository. Для implementation evidence связывайте CodeGraph с конкретным
Code Repository, код которого требуется исследовать.

Для выполнения во всех repositories, к которым подключён CodeGraph, укажите
`--all` явно:

```bash
openspec-orch plugin exec codegraph --all -- status --json
```

Интерактивный `plugin init` показывает checkbox каталога, а `plugin connect codegraph`
позволяет выбрать несколько repositories. `connect` нативно вызывает
`codegraph init .`, то есть первичная индексация выполняется сразу. Для явного
обновления одного instance используйте
`openspec-orch plugin sync codegraph --repo frontend`, а всех подключённых instances —
`openspec-orch plugin sync codegraph --all`. Без `--repo` и `--all` интерактивный
терминал показывает checkbox, а non-TTY вызов завершается ошибкой выбора.
Любую другую native-команду bundled CodeGraph можно вызвать через `plugin exec`;
Core выбирает подключённый Repository instance и без разбора передаёт Package весь
argv после `--`.

Перед индексацией Plugin добавляет `.codegraph/` в локальный `.git/info/exclude`.
Tracked `.gitignore` Repository не меняется, а сам индекс остаётся локальным и не
переносится в Store.

## MCP для агента

`openspec-orch init` сохраняет выбранный Agent ID в `openspec-orch.yaml`. Во время
`plugin init --plugin codegraph` только регистрирует Package в Store. После успешного
`plugin connect codegraph --repo <id>` Package передаёт Repository-scoped
`extension/` общему Agent Adapter, который штатным механизмом выбранного Agent:

- устанавливает Claude local Plugin либо активирует Qwen-compatible Extension в
  текущем workspace, устанавливая его в project scope только при отсутствии;
- для GigaCode использует Qwen CLI, но отдельный `gigacode-extension.json`;
- подключает stdio MCP server `openspec-orch-codegraph` в checkout выбранного
  Repository;
- загружает общий `agent-instructions.md`, не изменяя корневые `CLAUDE.md`, `QWEN.md`
  и `GIGACODE.md`.

MCP вызывает поставляемый executable `openspec-orch-codegraph`; отдельно устанавливать
глобальный `codegraph` не нужно. Для Qwen и GigaCode `plugin disconnect` отключает
Extension только в workspace этого checkout, не удаляя установленный package, и затем
удаляет binding. После connect/disconnect перезапустите Agent, затем проверьте его
список MCP tools и выполните один тестовый `codegraph_explore` из целевого Code
Repository.

До чтения графа агент должен получить разрешённый абсолютный путь без поиска по
файловой системе, подтвердить точный Git root и repository identity, полный commit
SHA, равенство `HEAD` этой revision и чистый working tree. Для нескольких
репозиториев выполняются отдельные проходы; межрепозиторный вывод собирается после
них.

## Политика использования

1. Не использовать CodeGraph для Intent, Proposal, Requirements, Scenarios или поиска
   продуктового scope. Сначала должна быть явно разрешена repository-specific стадия и
   сформулирован один технический claim.
2. Если исследование разрешено, `.codegraph/` существует и MCP доступен, для адресной
   карты реализации сначала использовать `codegraph_explore`.
3. Для другого Repository запускать отдельный разрешённый subagent из его checkout:
   там активируется собственный Repository-scoped Extension и MCP.
4. Если revision индекса неизвестна, индекс сообщает ошибку или не покрывает нужный
   язык, использовать обычные read/search tools внутри того же разрешённого checkout
   и явно назвать fallback.
5. Не объявлять runtime behavior, тест или внешний контракт подтверждённым только по
   ребру графа, когда решение Gate требует независимого evidence.
