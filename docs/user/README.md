# Пользовательская документация

Раздел описывает поддерживаемую работу с проектом и Change без внутренних деталей
реализации Orchestrator.

## Рекомендуемый порядок чтения

1. [Обзор](overview.md) — модель проекта, термины и границы продукта.
2. [Начало работы](getting-started.md) — создание Store, подключение workspace и
   первичная проверка.
3. Выберите основной процесс:
   - [один человек](solo-flow.md);
   - [команда и роли](team-flow.md).
4. Используйте [сценарии Change](change-scenarios.md) для Explore, `skip_specs`,
   изменения scope, Change Tracking, зависимых Changes и Archive.
5. При необходимости откройте [Plugins](plugins.md),
   [конфигурацию](configuration.md) или [Project Template](project-template.md).

## Опциональный слой implementation evidence

| Слой | Что делает |
|---|---|---|
| OpenSpec workflow | Ведёт Planning, Tasks, Apply и Archive независимо от Plugins |
| Change Tracking | Опционально фиксирует evidence scope, точные implementation revisions и проверку собранной версии |

`track` не переводит Change в другой режим и не означает «взять задачу в работу».
Команда только начинает сбор evidence по принятому `Repository Impact`. Отсутствие
Change Tracking не является ошибкой и не меняет штатный OpenSpec Apply.

## Где выполнять команды

Команды `openspec-orch`, `graph` и project commands агента запускаются из Store, если
в конкретном примере не указано иное. Реализация и repository-local проверки
выполняются в соответствующем Code Repository. Git-команды, PR, merge, deployment и
Release остаются действиями пользователя или внешней автоматизации.
