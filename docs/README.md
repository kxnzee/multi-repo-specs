# Документация

Примеры project-scoped команд в документации запускаются из Store. После `connect`
Orchestrator также может разрешить тот же Project из зарегистрированного Code
Repository через OpenSpec pointer. Соблюдайте scope конкретной команды:

- OpenSpec Graph работает с файлами Store;
- ручной `attempt start|complete` запускается из назначенного Code Repository;
- `init [path]` принимает явный target;
- `plugin register <id> [path]` создаёт отдельный Plugin package;
- `agent setup|status|remove` управляет user-level gateway и не требует Project.

Команды и skills Agent вызываются внутри выбранного Agent, а не как shell-команды.
Точный CLI текущей установленной версии показывает
`openspec-orch <command> --help`.

## Пользователям

| Задача | Документ |
|---|---|
| Понять назначение, модель и границы продукта | [Обзор](user/overview.md) |
| Установить или обновить Orchestrator, перенести Template changes, выполнить rollback | [Установка и обновление](user/installation-and-updates.md) |
| Создать новый Store или подключить существующий | [Начало работы](user/getting-started.md) |
| Настроить Project v1, repositories, Extensions, Plugins и local state | [Конфигурация](user/configuration.md) |
| Выбрать schema, понять artifacts или подготовить Custom Template | [Project Template](user/project-template.md) |
| Подключить Agent gateway, OpenSpec Graph, Change Tracking, CodeGraph или внешний Plugin | [Plugins](user/plugins.md) |
| Провести Change одному | [Поток одного человека](user/solo-flow.md) |
| Разделить роли, gates и multi-repository работу в команде | [Командный поток](user/team-flow.md) |
| Выбрать действие в пограничной ситуации | [Сценарии работы с Change](user/change-scenarios.md) |

Template `default` предоставляет две schemas: `spec-driven-extended` с Intent и
Intake и `superspec-multirepo` с обязательными Brainstorm, Plan и Process
Compliance. Schema выбирается отдельно для каждого Change; Orchestrator и Plugins не
создают параллельный workflow.

## Разработчикам

- [Архитектура](technical/architecture.md) — границы Core, Template, Extensions,
  Plugins и Agent adapters.
- [Модель данных](technical/data-model.md) — Project, Repository registry, bindings
  и локальное состояние.
- [Plugin Platform](technical/plugin-platform.md) — SDK, trusted runtime, command и
  repository contributions.
- [Поставка и совместимость](technical/distribution.md) — package composition,
  runtime requirements и version compatibility.
- [CLI и MCP reference](technical/reference.md) — команды, flags, MCP surface и exit
  behavior.
- [Разработка](technical/development.md) — структура checkout и обязательные
  проверки.

## Источники истины

Для runtime behavior приоритет имеют код, тесты и package manifests. Текущие
пользовательские и технические документы находятся только в `docs/user/` и
`docs/technical/`.

Project Template является copy-only пакетом: schemas и их templates находятся в
`templates/default/`. Agent workflow assets поставляются standalone Extensions из
`extensions/`. Requirements, Master Specs и Changes принадлежат отдельному
центральному Store, а не этому implementation repository.
