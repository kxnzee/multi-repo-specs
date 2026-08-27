# Документация OpenSpec Orchestrator

Этот каталог — самостоятельная документация текущей реализации OpenSpec
Orchestrator. Источник правды — код, схемы и тесты репозитория.

## С чего начать

| Задача | Документ |
|---|---|
| Понять назначение и границы продукта | [Обзор](user/overview.md) |
| Создать или подключить проект | [Начало работы](user/getting-started.md) |
| Провести Change одному человеку | [Поток одного человека](user/solo-flow.md) |
| Организовать работу команды и роли | [Командный поток](user/team-flow.md) |
| Выбрать маршрут для нестандартной ситуации | [Сценарии Change](user/change-scenarios.md) |
| Подключить расширение | [Plugins](user/plugins.md) |
| Проверить `openspec-orch.yaml` | [Конфигурация](user/configuration.md) |
| Разобраться в устройстве реализации | [Техническая документация](technical/README.md) |

## Разделы

- [`user/`](user/README.md) — действия владельца Change, аналитика, разработчика,
  тестировщика, лида и человека, совмещающего эти роли;
- [`technical/`](technical/README.md) — архитектура, данные, Plugin Platform,
  разработка и точный справочник реализованного контракта.

## Нормативная граница

OpenSpec владеет Requirements, Scenarios, Changes, Apply и Archive. Orchestrator
подготавливает Store и workspace, проверяет Git/OpenSpec-контекст и предоставляет
общую Plugin Platform. Project Template задает проектный процесс. Plugins добавляют
собственные данные, команды и проверки, но не становятся новым источником требований.

Core не выполняет `git add`, `commit`, `push`, `merge`, `rebase`, PR, deployment,
проектные тесты, ручную проверку, Release или Archive. Эти действия явно остаются у
пользователя, команды, OpenSpec или внешних систем.
