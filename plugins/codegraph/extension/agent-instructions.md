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
разрешённый `projectPath`.

Если `.codegraph/` существует, но CodeGraph MCP недоступен, останови исследование и
сообщи пользователю, что локальный индекс найден, но Agent не получил
`codegraph_explore`. Не используй вместо него `plugin exec`, `grep`, `rg`, `find` или
другой поиск без явного разрешения пользователя. Рекомендуй проверить
`openspec-orch plugin status --plugin codegraph --repo <repository-id>` и перезапустить
Agent; не выполняй `sync` или переподключение автоматически.

Обычный поиск допустим как явный fallback, только если `.codegraph/` отсутствует либо
сам `codegraph_explore` сообщил, что индекс stale или unavailable. Индекс не доказывает
runtime behavior или verification.
