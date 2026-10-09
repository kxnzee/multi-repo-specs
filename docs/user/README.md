# Документация для пользователей

Читайте по порядку: от установки до работы с Change. Каждый документ отвечает на
один вопрос и ссылается на следующий шаг.

Примеры написаны для GigaCode. Для Claude и Qwen см. [отличия](other-agents.md).

## Начало работы

| Шаг | Кому | Документ |
|---|---|---|
| 0 | Всем | [Основные понятия](concepts.md): Store, репозитории, Change, сессии агента |
| 1 | Всем, один раз на машину | [Установка](installation.md): Orchestrator, OpenSpec, CLI и шлюз агента |
| 2а | Тому, кто заводит проект | [Создание нового проекта](new-project.md): `init`, первый `connect`, публикация Store |
| 2б | Участнику команды | [Подключение к существующему проекту](join-project.md): clone Store, `connect`, `doctor` |
| 3 | Аналитику и команде | [Бизнес-контекст](project-context.md): описание продукта для агента |

## Работа с Change

| Этап | Где | Документ |
|---|---|---|
| Обзор | Store и репозитории | [Жизненный цикл Change](change/README.md): этапы, команды агента, выбор schema |
| 1. Planning | Store | [Planning](change/planning.md): требования, план, принятие; baseline для работающей системы |
| 2. Apply | Репозиторий кода | [Apply](change/apply.md): реализация в каждом назначенном репозитории |
| 3. Verify | Store | [Verify](change/verify.md): проверка кандидата и решение человека |
| 4. Archive | Store | [Archive](change/archive.md): перенос дельты в Master Specs |

## Сопровождение

| Задача | Документ |
|---|---|
| Обновить Orchestrator, плагины, шлюз; мигрировать Store; откатиться | [Сопровождение](maintenance.md) |
| Разобраться с ошибкой `doctor` или восстановиться после сбоя | [Диагностика](troubleshooting.md) |
| Подключить, обновить или удалить плагин или расширение | [Плагины и расширения](../plugins/operations.md) |

## Дополнительно

| Тема | Документ |
|---|---|
| Процесс команды: Jira Story, Git Flow, роли и контрольные точки | [Процесс работы над Jira Story](story-delivery-process.md) |
| Шаблоны Store: `default` и `initiative` | [Шаблоны](../templates/README.md) |
| Каталог плагинов и расширений | [Плагины](../plugins/README.md), [Расширения](../extensions/README.md) |
| Свои Extension, Plugin или Template | [Создание дополнений](creating-addons.md) |
| Команды CLI, MCP, конфигурация | [Техническая документация](../core/README.md) |
