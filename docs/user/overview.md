# Обзор

OpenSpec Orchestrator связывает один центральный OpenSpec Store с несколькими Code
Repositories и выбранным локальным AI Agent. Он даёт команде единый переносимый
контур для Requirements и Changes, координации реализации в нескольких Code
Repositories, восстановления окружения на новой машине и подключения независимых
Plugins.

## Модель проекта

Project содержит:

- один Store с Requirements, Master Specs и Changes;
- зарегистрированные Code Repositories, локальные checkout которых подготавливает
  `connect`;
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
| Project Template | `openspec/config.yaml`, context, schemas и copy-only assets |
| Extension | Agent instructions, commands, skills и MCP manifests |
| Plugin | собственные команды, runtime и repository lifecycle |
| Команда | реализация, review, тестирование, deployment, Release и Archive |

Core не интерпретирует требования, не реализует Change и не выполняет Release. По
контракту Plugin меняет только состояние, которым владеет. Plugin package является
доверенным in-process кодом: SDK ограничивает передаваемый context, файловые пути и
параметры процессов, но не служит sandbox.

## Обычный путь

```text
установить Orchestrator
→ создать или клонировать Store
→ при необходимости установить внешние Plugins
→ connect
→ doctor и repository status
→ при необходимости настроить Agent gateway и Plugin bindings
→ выбрать schema и вести Change штатным OpenSpec workflow
→ пройти человеческий Verify, принять Release-решение и выполнить Archive
```

Template `default` предоставляет короткую schema `spec-driven-extended` и полную
`superspec-multirepo`. Schema выбирается отдельно для каждого Change.

## Что опционально

- OpenSpec Graph строит и проверяет структуру Specs и Changes по файлам Store.
- CodeGraph индексирует код отдельного Repository и ускоряет навигацию по выбранному
  checkout.
- Change Tracking сохраняет историю попыток и связывает OpenSpec tasks с конкретными
  implementation revisions Code Repositories.
- Agent gateway предоставляет governed MCP, но не заменяет CLI и человеческие gates.

Начните с [установки](installation-and-updates.md) и
[создания проекта](getting-started.md).
