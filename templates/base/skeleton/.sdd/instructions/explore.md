# Explore в OpenSpec Orchestrator Alpha

Команда `openspec-orch explore` удалена из Alpha. Не пытайся восстановить её
runtime, параметры или прежний handoff.

Исследование и подготовка Change выполняются штатным процессом OpenSpec, отдельно
от Orchestrator. Alpha подключается только после того, как planning-состояние
Change принято и закоммичено в центральном Store:

```text
openspec-orch assign <change-id> --repo <repository-id>...
```

До `assign` Orchestrator не определяет scope, не читает код и не создаёт Change.
