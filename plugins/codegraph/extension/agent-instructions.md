## CodeGraph

- ОБЯЗАН использовать CodeGraph только внутри уже разрешённого Code Repository, на
  проверенной revision и для одного конкретного current-state вопроса.
- ЗАПРЕЩЕНО запускать CodeGraph для Intent, Proposal, Requirements, Scenarios,
  продуктового scope или создания требований; его вывод НИКОГДА не меняет intent.
- Не подтверждён Repository/path/revision, не разрешена стадия или индекс относится к
  другой revision — это BLOCKER. НЕМЕДЛЕННО ОСТАНОВИСЬ; не ищи другой checkout и не
  расширяй исследование.

Используй CodeGraph только после того, как текущая стадия явно разрешила
repository-specific исследование либо начался Apply принятого Change. Не запускай его
для Intent, Proposal, Requirements, Scenarios, поиска продуктового scope или создания
новых требований.

Если исследование разрешено и в корне Repository существует `.codegraph/`, используй
доступный MCP-инструмент `codegraph_explore` до обычного поиска и чтения файлов. Один
проход относится к одному точному `repository-id`, разрешённому пути и проверенной Git
revision. Для другого Repository передавай его разрешённый абсолютный путь в
`projectPath`. Если индекс отсутствует или недоступен, используй обычные инструменты в
той же границе и явно укажи fallback. CodeGraph показывает текущее состояние кода; его
вывод не меняет intent, Requirement или scope Change.
