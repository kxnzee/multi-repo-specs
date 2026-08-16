---
description: "Недоступно в OpenSpec Orchestrator Alpha"
---

# `/sdd-apply` вне Alpha

Эта project-level инструкция зависела от удалённой команды
`openspec-orch load` и runtime Work Packages прежней версии. В Alpha не запускай
её и не восстанавливай скрытый runtime по истории диалога или файлам старого
формата.

Реализация выполняется обычным процессом команды вне Orchestrator. Alpha хранит
только принятый Cycle и проверяемые результаты:

```text
openspec-orch status <change-id>
openspec-orch record assignment <change-id> --repo <repository-id> --commit <sha> --status completed --source <source>
```

После записи результатов всех репозиториев продолжи через `verify` и
`record verification`. Если пользователь ожидает автоматический Apply, сообщи,
что эта возможность отложена до следующей версии.
