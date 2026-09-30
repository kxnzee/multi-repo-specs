# OpenSpec Apply

Extension `openspec-apply` — Code-only точка входа реализации принятого Change.
Она устанавливается штатным native Extension lifecycle выбранного Agent и не
копирует полный OpenSpec Agent Pack из Store в Code Repository.

Для Qwen и GigaCode используйте `/opsx-apply <change-id>`, для Claude Plugin —
`/openspec-apply:opsx-apply <change-id>`. Команда получает Apply instructions,
assignment и opaque task IDs через MCP `openspec-orchestrator`. При недоступном MCP
она останавливается без CLI или файлового fallback к Store.

Одна итерация выполняет одну Task текущего Repository:

1. проверяет Change, assignment и checkout;
2. реализует Task и запускает относящиеся проверки;
3. показывает человеку diff, результаты и предлагаемый commit;
4. ждёт явного согласия на этот commit;
5. создаёт один task-scoped commit и только затем отмечает Task через
   `set_task_completion`;
6. останавливается до следующей итерации.

Push, rebase, merge и reset не входят в этот gate. Store files и task checkbox не
редактируются из Code Repository напрямую. Исходные манифесты и команда находятся
в `extensions/openspec-apply/`.
