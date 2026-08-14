# Конфигурация `openspec-orch.yaml`

`openspec-orch.yaml` находится в корне центрального Store Repository и описывает совместимую версию OpenSpec, выбранный агент и репозитории SDD-проекта. Файл создаётся командой `openspec-orch init` и используется командами Harness как машинная конфигурация.

## Полный пример

```yaml
versions:
  openspec: "1.7.0"

agent:
  id: qwen
  openspec_adapter: qwen
  architecture: markdown-commands
  commands_directory: .qwen/commands
  instructions_file: QWEN.md

repositories:
  - id: sdd-specs
    role: store
    url: https://example.test/sdd-specs.git
    default_branch: main

  - id: frontend
    role: code
    url: https://example.test/frontend.git
    default_branch: main
```

## `versions`

| Поле | Назначение |
|---|---|
| `versions.openspec` | Версия OpenSpec, с которой совместим Harness. Сейчас поддерживается только `1.7.0`; другая версия блокирует команды OpenSpec Orchestrator. |

## `agent`

Секция определяет provider-specific пути и формат интеграции выбранного агента. Все её поля формируются согласованным набором и должны соответствовать встроенному адаптеру Harness.

| Поле | Назначение |
|---|---|
| `agent.id` | Выбранный агент. Поддерживаются `qwen` и `gigacode`. |
| `agent.openspec_adapter` | Адаптер, через который OpenSpec устанавливает штатные команды. Для Qwen и GigaCode используется `qwen`. |
| `agent.architecture` | Формат интеграции команд. Для поддерживаемых агентов используется `markdown-commands`. |
| `agent.commands_directory` | Относительный путь к каталогу команд: `.qwen/commands` или `.gigacode/commands`. |
| `agent.instructions_file` | Относительный путь к файлу постоянных инструкций и контекста текущего репозитория: `QWEN.md` или `.gigacode/GIGACODE.md`. |

Поддерживаемые наборы значений:

| `agent.id` | `openspec_adapter` | `architecture` | `commands_directory` | `instructions_file` |
|---|---|---|---|---|
| `qwen` | `qwen` | `markdown-commands` | `.qwen/commands` | `QWEN.md` |
| `gigacode` | `qwen` | `markdown-commands` | `.gigacode/commands` | `.gigacode/GIGACODE.md` |

Не изменяйте отдельное поле этой секции независимо от остальных. Если значения не соответствуют выбранному `agent.id`, Harness отклонит конфигурацию.

### Путь к инструкциям Code Repository

`agent.instructions_file` не создаёт новый файл и не содержит абсолютный путь. Оно задаёт одинаковое для выбранного агента расположение файла инструкций относительно корня каждого репозитория.

Перед Repository Context Pass основной агент формирует:

```text
repository_instructions_path = <checkout>/<agent.instructions_file>
```

Примеры:

```text
Qwen:
checkout = /workspace/src/frontend
repository_instructions_path = /workspace/src/frontend/QWEN.md

GigaCode:
checkout = /workspace/src/frontend
repository_instructions_path = /workspace/src/frontend/.gigacode/GIGACODE.md
```

Основной агент проверяет, что путь остаётся внутри `checkout`, и передаёт его native subagent в prompt конкретного запуска. Путь не записывается обратно в `openspec-orch.yaml`. Если файла в Code Repository нет, Repository Context Pass продолжает работу через минимальное адресное чтение кода и тестов.

## `repositories`

`repositories` — список репозиториев SDD-проекта. В нём должен быть ровно один центральный Store Repository и могут быть перечислены Code Repositories.

| Поле | Назначение |
|---|---|
| `repositories[].id` | Устойчивый идентификатор репозитория в lowercase kebab-case. Используется в командах и OpenSpec-артефактах независимо от имени локального каталога. |
| `repositories[].role` | Роль репозитория: `store` для центральных спецификаций или `code` для реализации. |
| `repositories[].url` | Git URL репозитория. Встроенные в HTTP(S)-URL логин и пароль запрещены. |
| `repositories[].default_branch` | Основная ветка репозитория, относительно которой выполняются подключение, Explore и подготовка Change. |

Идентификаторы репозиториев не должны повторяться. Репозиторий с `role: store` является единственным источником OpenSpec Changes и Master Specs. Репозитории с `role: code` реализуют принятые изменения и не содержат собственные `openspec/changes`.

## Редактирование

YAML-комментарии допустимы и не влияют на разбор файла. При ручном изменении сохраняйте имена полей и их структуру: Harness выполняет строгую проверку конфигурации до запуска проектных операций.
