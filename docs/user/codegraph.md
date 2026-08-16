# CodeGraph для Code Repositories

[`colbymchenry/codegraph`](https://github.com/colbymchenry/codegraph) создаёт локальный
семантический граф кода и предоставляет его агенту через MCP. Интеграция является
опциональной возможностью Code Repository и не входит в Orchestrator Core.

## Граница ответственности

- Один Code Repository — один локальный каталог `.codegraph/`.
- `.codegraph/` является производным индексом и не коммитится в Git.
- Центральный OpenSpec Store не хранит копии графов Code Repositories.
- CodeGraph ускоряет навигацию, но Requirements и наблюдаемое поведение по-прежнему
  подтверждаются Specs, кодом, контрактами и тестами.
- Отсутствующий или неисправный CodeGraph не блокирует OpenSpec workflow: агент
  возвращается к адресному read/search.

## Подготовка одного репозитория

После установки CodeGraph:

```bash
cd <абсолютный путь до Code Repository>
codegraph init
codegraph status
```

Добавьте `.codegraph/` в `.gitignore` каждого Code Repository. Перед отдельным
скриптовым исследованием выполните `codegraph sync`; MCP server также выполняет
сверку индекса при подключении.

## MCP для Qwen/GigaCode

Настройте stdio MCP server с alias `codegraph`:

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

Alias является частью контракта Template: read-only subagents разрешают только
инструменты `mcp__codegraph__codegraph_*`. После настройки проверьте `/mcp`, `/tools`
и отдельный запуск `openspec-implementation-scout` на тестовом вопросе.

## Политика использования

1. Если `.codegraph/` существует и MCP доступен, сначала вызвать
   `codegraph_status`.
2. Для первичной карты задачи использовать `codegraph_context`.
3. Для влияния изменения использовать `codegraph_impact`, для пути вызовов —
   `codegraph_trace`, для точечной навигации — search/node/callers/callees.
4. Если индекс сообщает ошибку или не покрывает нужный язык, использовать обычные
   read/search tools и явно назвать fallback.
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

Массовую установку и автоматизацию через Orchestrator рассматривать только после
этого пилота.
