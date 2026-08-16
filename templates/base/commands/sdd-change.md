---
description: "Недоступно в OpenSpec Orchestrator Alpha"
---

# `/sdd-change` вне Alpha

Эта project-level команда относилась к прежнему полному процессу Orchestrator и в
Alpha не выполняется. Не вызывай удалённые `openspec-orch explore` или
`openspec-orch change` и не имитируй их поведение.

Создай и согласуй Change штатными командами OpenSpec. Когда planning-артефакты
готовы и закоммичены в центральном Store, продолжи через:

```text
openspec-orch assign <change-id> --repo <repository-id>...
```

Если пользователь ожидал автоматизированный старый flow, остановись и объясни,
что он не входит в Alpha.
