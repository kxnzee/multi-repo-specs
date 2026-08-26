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

## Два поддерживаемых режима Change

| Режим | Когда использовать | Что добавляет |
|---|---|---|
| Standard OpenSpec + Graph | Change Tracking не подключен или после `CYCLE_NOT_FOUND` человек явно выбрал Standard Apply | Planning, Graph scope, штатные Apply/Archive; commits и verification фиксируются процессом команды |
| OpenSpec + Graph + Change Tracking | Нужен локальный Cycle с точной planning revision и набором implementation commits | Cycle Record, Result Receipts, Snapshot и Verification Receipt |

Отсутствие Change Tracking не является ошибкой. Если Cycle уже существует, обходить
его переключением на Standard Apply нельзя: нужно продолжить orchestrated flow или
явно пересоздать Cycle после нового Planning/Gate 1.

## Где выполнять команды

Команды `openspec-orch`, `graph` и project commands агента запускаются из Store, если
в конкретном примере не указано иное. Реализация и repository-local проверки
выполняются в соответствующем Code Repository. Git-команды, PR, merge, deployment и
Release остаются действиями пользователя или внешней автоматизации.
