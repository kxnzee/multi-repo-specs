# Orchestrator Agent

Расширение `orchestrator-agent` поставляет MCP-gateway для клиента Claude, Qwen
или GigaCode. Gateway даёт доступ к контексту и инструментам Orchestrator, но не
управляет сессией, моделью или разрешениями клиента.

Для прогресса Apply Gateway публикует `set_task_completion`. Code Repository Agent
передаёт точные `change_id` и `task_id` из актуальных Apply instructions, а Core
разрешает основной Store, повторно сверяет задачу и атомарно меняет только её
checkbox. Прямой файловый доступ Code Repository к Store для этого не требуется.

Первичную настройку описывает [быстрый старт](../user/quick-start.md). Исходные
манифесты лежат в `extensions/orchestrator-agent/`.
