# Конфигурация `openspec-orch.yaml`

`openspec-orch.yaml` находится в корне центрального Store Repository и описывает режим Core, выбранный агент и репозитории проекта. Файл создаётся командой `openspec-orch init` и используется командами Core как машинная конфигурация. Версия OpenSpec здесь намеренно не закрепляется.

## Полный пример

```yaml
version: 1
strict: true

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

## `strict`

| Поле | Назначение |
|---|---|
| `strict` | Project default для Git-гарантий Core. Значение `true` используется по умолчанию, включая старые конфиги без этого поля. `false` включает relaxed mode для всех Core-команд. |

Флаг `--no-strict` временно включает relaxed mode для одного вызова и имеет приоритет над project default. Обратного флага нет: Core не переходит в strict поверх `strict: false` и никогда не ослабляет режим автоматически после ошибки strict-проверки.

В strict mode Core проверяет Git identity, origin, основную ветку и чистоту, управляет рабочими ветками и формирует runtime на точной Spec Baseline. В relaxed mode Core не клонирует репозитории, не проверяет Git remote/branch/clean state, не создаёт ветки, использует текущий OpenSpec root и маркирует ревизии как `unpinned`. Проверки OpenSpec identity и JSON, безопасных путей, symlink и разрешённых roots действуют в обоих режимах.

| Команда | Strict | Relaxed |
|---|---|---|
| `init` | Создаёт проект с `strict: true`. | `--no-strict` сохраняет `strict: false` как project default. Сам `init` всё равно читает Git URL и текущую default branch центрального репозитория для обязательной конфигурации Store. |
| `connect` | Клонирует отсутствующие Code Repositories и проверяет их Git-состояние. | Использует только уже существующие `<workspace>/src/<repository-id>` и не вызывает Git для их проверки. |
| `explore` | Фиксирует чистые актуальные revisions Store и выбранных Code Repositories. | Передаёт текущие разрешённые roots с markers `unpinned`. |
| `change` | Проверяет Store Git-state и создаёт или продолжает planning branch. | Создаёт или продолжает Change через OpenSpec без управления ветками. |
| `load` | Требует `--baseline`, создаёт immutable Store worktree и implementation branch, запускает OpenSpec validation с `--strict`. | Не принимает `--baseline`, использует текущий Store root, не управляет Git и запускает validation без `--strict`. |

Рекомендуемая и проверенная версия — OpenSpec `1.7.0`. Это рекомендация документации, а не exact pin: Core проверяет semantic version CLI, фактически вызываемые команды и обязательные поля их JSON-ответов. Обновление совместимого OpenSpec или project-local schema не требует изменения этого файла или повторного `init`.

## `agent`

Секция определяет provider-specific пути и формат интеграции выбранного агента. Все её поля формируются согласованным mapping выбранного Project Template; Core не содержит registry конкретных агентов.

| Поле | Назначение |
|---|---|
| `agent.id` | Выбранный agent mapping из Project Template. Базовый Template поставляет `qwen` и `gigacode`. |
| `agent.openspec_adapter` | Адаптер, через который OpenSpec устанавливает штатные команды. Для Qwen и GigaCode используется `qwen`. |
| `agent.architecture` | Формат интеграции команд. Для поддерживаемых агентов используется `markdown-commands`. |
| `agent.commands_directory` | Относительный путь к каталогу команд: `.qwen/commands` или `.gigacode/commands`. |
| `agent.instructions_file` | Относительный путь к файлу постоянных инструкций и контекста текущего репозитория: `QWEN.md` или `.gigacode/GIGACODE.md`. |

Поддерживаемые наборы значений:

| `agent.id` | `openspec_adapter` | `architecture` | `commands_directory` | `instructions_file` |
|---|---|---|---|---|
| `qwen` | `qwen` | `markdown-commands` | `.qwen/commands` | `QWEN.md` |
| `gigacode` | `qwen` | `markdown-commands` | `.gigacode/commands` | `.gigacode/GIGACODE.md` |

Пользовательский Template может определить другой согласованный набор. Core проверяет структуру и безопасность путей, но не сравнивает agent mapping со встроенным списком.

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

YAML-комментарии допустимы и не влияют на разбор файла. При ручном изменении сохраняйте имена полей и их структуру: Orchestrator Core выполняет строгую проверку конфигурации до запуска проектных операций.
