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
→ doctor
→ при необходимости настроить Agent gateway и Plugin bindings
→ выбрать schema и вести Change штатным OpenSpec workflow
→ пройти ИФТ и человеческий Verify
→ выполнить Archive и передать Jira Story на UAT
→ после UAT принять Release-решение и выполнить Release по Git Flow
```

Приведённый путь относится к проектам, выбравшим процесс Jira Story / Git Flow.
Template не задаёт Git-конвенцию: команда записывает свой порядок поставки,
маршруты изменений и согласования отдельно от бизнес-контекста, в `openspec/process/`.
Orchestrator их не валидирует.

Процесс для конкретного Change и выбор схемы описаны в
[сценариях Change](brownfield-and-changes.md#сценарии-работы-с-change).

## Что опционально

- Плагины добавляют Graph, навигацию по коду и связь задач с ревизиями.
- Agent gateway даёт доступ к MCP, но не заменяет CLI и человеческие решения.

Начните с [установки](installation-and-updates.md) и
[создания проекта](getting-started.md). Полный путь Jira Story описан в
[едином процессе поставки](story-delivery-process.md), а состав и подключение
плагинов - в [руководстве Plugins](plugins.md).
