# Документация

Project-команды `openspec-orch` выполняются из корня Store, а `attempt` — из Code
Repository. `init [path]`, `plugin register <id> [path]` и пользовательские команды
`agent setup|status|remove` принимают явный target или не требуют Project. Команды и
skills Agent выполняются внутри выбранного Agent, а не в shell.

## Пользователям

- [Обзор](user/overview.md) — назначение и границы Orchestrator.
- [Установка и обновление](user/installation-and-updates.md) — pilot delivery,
  миграция и rollback.
- [Начало работы](user/getting-started.md) — создание или подключение Store.
- [Конфигурация](user/configuration.md) — `openspec-orch.yaml` и local state.
- [Project Template](user/project-template.md) — schemas и custom Template.
- [Plugins](user/plugins.md) — подключение и эксплуатация расширений.
- [Командный процесс](user/team-flow.md) и [личный процесс](user/solo-flow.md).
- [Сценарии работы с Change](user/change-scenarios.md) — краткая матрица решений.

## Разработчикам

- [Архитектура](technical/architecture.md)
- [Модель данных](technical/data-model.md)
- [Plugin Platform](technical/plugin-platform.md)
- [Поставка и совместимость](technical/distribution.md)
- [CLI reference](technical/reference.md)
- [Разработка](technical/development.md)

Код, тесты и package manifests имеют приоритет над документацией. Проектные
workflow-артефакты находятся в `templates/` и `extensions/` и поставляются как часть
продукта.
