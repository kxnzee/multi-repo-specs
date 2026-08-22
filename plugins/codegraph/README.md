# CodeGraph Plugin Package

[`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph) создаёт локальный
семантический граф кода и предоставляет его агенту через CLI и MCP. Orchestrator
поставляет отдельный CodeGraph Plugin; он не связан с Project Template.

## Граница ответственности

- Один Code Repository — один локальный каталог `.codegraph/`.
- `.codegraph/` является производным индексом и не коммитится в Git.
- Центральный OpenSpec Store не хранит копии графов Code Repositories.
- CodeGraph ускоряет навигацию, но Requirements и наблюдаемое поведение по-прежнему
  подтверждаются Specs, кодом, контрактами и тестами.
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
openspec-orch codegraph --repository frontend explore "authentication flow"
```

Интерактивный `plugin init` показывает checkbox каталога, а `plugin connect codegraph`
позволяет выбрать несколько repositories. `connect` нативно вызывает
`codegraph init .`, то есть первичная индексация выполняется сразу. Для явного
обновления используйте `openspec-orch plugin sync codegraph --repo frontend`.

Добавьте `.codegraph/` в `.gitignore` каждого Code Repository. Сам индекс остаётся
локальным и не переносится в Store.

## MCP для агента

Встроенная зависимость обслуживает lifecycle и нативные команды Plugin. Прямое
подключение stdio MCP к агенту пока остаётся отдельной интеграцией CodeGraph и не
маршрутизируется через CLI Orchestrator. Если оно требуется, настройте MCP server с
alias `codegraph` по инструкции используемого агента:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Plugin намеренно не изменяет Project Template и provider-specific файлы агента.
После отдельной настройки MCP проверьте `/mcp` или `/tools` и один тестовый вопрос на
одном `repository-id` и одной точной Git revision.

До чтения графа агент должен получить разрешённый абсолютный путь без поиска по
файловой системе, подтвердить точный Git root и repository identity, полный commit
SHA, равенство `HEAD` этой revision и чистый working tree. Для нескольких
репозиториев выполняются отдельные проходы; межрепозиторный вывод собирается после
них.

## Политика использования

1. Если `.codegraph/` существует и MCP доступен, сначала вызвать
   `codegraph_status` и убедиться, что индекс соответствует проверенной revision.
2. Для первичной карты задачи использовать `codegraph_explore`.
3. Для влияния изменения использовать `codegraph_impact`, для точечной навигации —
   explore/node/callers/callees.
4. Если revision индекса неизвестна, индекс сообщает ошибку или не покрывает нужный
   язык, использовать обычные read/search tools внутри того же разрешённого checkout
   и явно назвать fallback.
5. Не объявлять runtime behavior, тест или внешний контракт подтверждённым только по
   ребру графа, когда решение Gate требует независимого evidence.

## Пилот

Для первого Code Repository измерить одинаковый набор вопросов с CodeGraph и без
него:

- время ответа;
- число tool calls и прочитанных файлов;
- полноту найденных точек влияния;
- количество ложных или неподтверждённых связей;
- свежесть после изменения файла и `codegraph sync`.

После пилота отдельно оценить массовые операции для сотен repositories; текущий
Plugin намеренно подключается к каждому Repository явно.
