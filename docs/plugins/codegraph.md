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

Диагностика и отключение описаны в [общем lifecycle](operations.md). Канонический
контракт находится в [исходном README](../../plugins/codegraph/README.md).
