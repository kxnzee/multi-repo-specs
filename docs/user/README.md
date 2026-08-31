# Пользовательская документация

Начните с [обзора](overview.md), затем используйте нужный раздел:

- [установка и обновление](installation-and-updates.md);
- [создание и подключение Store](getting-started.md);
- [конфигурация](configuration.md);
- [Project Template и schemas](project-template.md);
- [Plugins](plugins.md);
- [процесс одного человека](solo-flow.md);
- [командный процесс и роли](team-flow.md);
- [нестандартные сценарии Change](change-scenarios.md).

Project-команды `openspec-orch` выполняются из корня Store, а `attempt` — из Code
Repository. `init [path]`, `plugin register <id> [path]` и пользовательские команды
`agent setup|status|remove` принимают явный target или не требуют Project. Команды и
skills Agent выполняются внутри выбранного Agent, а не в shell.
