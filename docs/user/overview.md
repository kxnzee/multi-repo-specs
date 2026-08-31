# Обзор

OpenSpec Orchestrator связывает один центральный OpenSpec Store с несколькими Code
Repositories и локальными AI Agents. Он нужен, чтобы одинаково создавать проект,
восстанавливать окружение на новой машине и подключать независимые Plugins.

## Модель проекта

Project содержит:

- один Store с Requirements, Master Specs и Changes;
- ноль или несколько Code Repositories;
- один Project Template и один Agent;
- набор standalone Extensions;
- необязательные Plugins и их bindings.

`openspec-orch.yaml` хранится в Store и является переносимой конфигурацией проекта.
Локальные checkout и Plugin caches в Git не попадают.

## Границы

| Компонент | Ответственность |
|---|---|
| OpenSpec | Specs, Changes, schemas и artifact lifecycle |
| Orchestrator Core | init, connect, diagnostics, repository routing и Plugin host |
| Project Template | project-local config, context, schemas и assets |
| Extension | Agent instructions, commands, skills и MCP manifests |
| Plugin | собственные команды, runtime и repository lifecycle |
| Команда | реализация, review, тестирование, deployment, Release и Archive |

Core не интерпретирует требования, не реализует Change и не выполняет Release. Plugins
могут менять только состояние, которым владеют, через ограниченный SDK.

## Обычный путь

```text
установить Orchestrator
→ создать или клонировать Store
→ connect
→ при необходимости подключить Plugins
→ вести Changes штатным OpenSpec workflow
→ проверять окружение через doctor
```

Template `default` предоставляет короткую schema `spec-driven-extended` и полную
`superspec-multirepo`. Schema выбирается отдельно для каждого Change.

## Что опционально

- OpenSpec Graph проверяет структуру и связи Store.
- CodeGraph ускоряет навигацию по выбранному checkout.
- Change Tracking фиксирует точные implementation revisions и результат внешней
  проверки.
- Agent gateway предоставляет governed MCP, но не заменяет CLI и человеческие gates.

Начните с [установки](installation-and-updates.md) и
[создания проекта](getting-started.md).
