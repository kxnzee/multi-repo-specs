# CodeGraph Plugin Package

[`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph) создаёт локальный
семантический граф кода и предоставляет его агенту через CLI и MCP. Orchestrator
поставляет отдельный CodeGraph Plugin; он не связан с Project Template.

## Граница ответственности

- Один Code Repository — один локальный каталог `.codegraph/`.
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
`plugin init codegraph` Package автоматически:

- добавляет stdio MCP server `openspec-orch-codegraph` в project-local конфиг каждого
  зарегистрированного Claude, Qwen или GigaCode;
- указывает абсолютные пути к текущему Node.js и bundled launcher, поэтому глобальный
  `codegraph` в `PATH` не нужен;
- добавляет в project instructions короткое правило использования
  `codegraph_explore`;
- сохраняет существующие MCP servers и пользовательские инструкции.

Эти adapters находятся в CodeGraph Package, а не в Core или Project Template.
`plugin remove codegraph` симметрично удаляет только принадлежащие Package блоки.
После `plugin init` или `plugin remove` перезапустите агент, затем проверьте его список
MCP tools и выполните один тестовый `codegraph_explore`.

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
3. При обращении к другому checkout передавать его разрешённый абсолютный путь через
   `projectPath`; один MCP server обслуживает несколько проиндексированных repositories.
4. Если revision индекса неизвестна, индекс сообщает ошибку или не покрывает нужный
   язык, использовать обычные read/search tools внутри того же разрешённого checkout
   и явно назвать fallback.
5. Не объявлять runtime behavior, тест или внешний контракт подтверждённым только по
   ребру графа, когда решение Gate требует независимого evidence.
