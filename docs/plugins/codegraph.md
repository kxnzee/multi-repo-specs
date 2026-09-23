# CodeGraph

CodeGraph строит локальный индекс выбранного репозитория кода и помогает агенту
находить связанные части реализации. Он не заменяет проверку требований или
границ Change.

Подключите плагин к нужному репозиторию кода и постройте индекс:

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin exec --repo frontend codegraph explore "authentication flow"
```

Каждый binding обслуживает один checkout и его локальный `.codegraph/`. Индекс не
коммитится: плагин добавляет его в `.git/info/exclude`, не меняя tracked `.gitignore`.
Состояние `stale` или `unavailable` требует явного `sync`.

Подключённый Plugin публикует read-only инструмент `codegraph_explore` через общий
`openspec-orchestrator` MCP. Передайте `repository_id` подключённого Repository
и один конкретный `query` с точными paths или symbols. Orchestrator сам выбирает
checkout по binding и не принимает произвольный путь от агента. Поэтому основной
агент, запущенный из Store, и его subagent видят один и тот же инструмент.

Перед первым использованием после connect, disconnect или обновления перезапустите
Agent либо долгоживущий MCP-процесс. Если индекс stale или unavailable, инструмент
завершится ошибкой; `sync` остаётся отдельным явным действием пользователя.
Если binding готов, но текущая сессия не видит `codegraph_explore`, Agent проверяет
его через `openspec-orch plugin status --plugin codegraph --repo <repository-id> --json`
и выполняет тот же read-only запрос командой
`openspec-orch plugin exec --repo <repository-id> codegraph explore "<query>"`.
Этот fallback остаётся внутри CodeGraph Plugin и не разрешает `grep`, `rg`, прямое
чтение исходников, автоматический `sync` или reconnect.

Диагностика и отключение описаны в [общем lifecycle](operations.md). Канонический
контракт находится в [исходном README](../../plugins/codegraph/README.md).
