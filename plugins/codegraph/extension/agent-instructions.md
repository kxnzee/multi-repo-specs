## CodeGraph

- Сначала получи разрешённые Repository, path и revision через Orchestrator MCP
  `get_assignment_scope`. Используй CodeGraph только внутри этого scope и для одного
  конкретного current-state вопроса.
- ЗАПРЕЩЕНО запускать CodeGraph для Intent, Proposal, Requirements, Scenarios,
  продуктового scope или создания требований; его вывод НИКОГДА не меняет intent.
- Не подтверждён scope, не разрешена стадия или индекс относится к другой revision —
  это BLOCKER. Не ищи другой checkout и не расширяй исследование.

Если исследование разрешено и в корне Repository существует `.codegraph/`, используй
доступный MCP-инструмент `codegraph_explore` до обычного поиска и чтения файлов. Один
проход относится к одному Repository и revision. Для другого Repository передавай
разрешённый `projectPath`. Если индекс недоступен, используй обычные инструменты в той
же границе и укажи fallback. Индекс не доказывает runtime behavior или verification.
