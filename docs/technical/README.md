# Техническая документация

Раздел предназначен для разработки, ревью и эволюции Orchestrator и first-party
Plugins. Пользовательский процесс находится в [`../user/`](../user/README.md).

## Документы

1. [Архитектура](architecture.md) — компоненты, зависимости и основные execution
   paths.
2. [Данные и состояние](data-model.md) — конфигурация, tracked/local storage, Cycle,
   Snapshot и графы.
3. [Plugin Platform](plugin-platform.md) — package contract, contributions,
   lifecycle, scoped facades и command execution.
4. [Разработка](development.md) — структура monorepo, правила изменения и проверки.
5. [Точный reference](reference.md) — компактный реализованный контракт и CLI
   surface.

## Нормативность

Эти документы объясняют реализацию, но не заменяют код. Публичными программными
границами являются CLI и `@openspec-orch/plugin-sdk`; Core internals не являются API
для Plugin packages. Проектный workflow принадлежит standalone или Plugin-owned
Extensions, а Project Template ограничен context, custom schema/config и copy-only
assets. Ни одна из этих политик не должна реализовываться условиями по конкретным
Plugin ID внутри Core.

Не реализованные Jira, Zephyr и Confluence adapters не описываются как действующие
компоненты. Их допустимая граница — отдельный Plugin package или внешний сервис после
принятия API, product edition, credential model и storage ownership.
