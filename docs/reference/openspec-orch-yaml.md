# Конфигурация `openspec-orch.yaml`

> [!IMPORTANT]
> Справочник описывает Alpha v1 — формат, который парсит текущий строгий parser
> (`src/internal/config/`). Нормативный источник — раздел 3.2
> [Alpha Concept](../OpenSpec-Orchestrator-Alpha-Concept.md); публичная грамматика CLI —
> [Alpha Implementation Plan](../OpenSpec-Orchestrator-Alpha-Implementation-Plan.md).
> Секции `agent`/`handoffs` и поля `role`/`url` предыдущего прототипа отклоняются строгой
> схемой и в Alpha v1 не входят.

`openspec-orch.yaml` находится в корне центрального Store Repository и описывает режим Core и репозитории проекта. Файл создаётся командой `openspec-orch init` и используется командами Core как машинная конфигурация. Версия OpenSpec здесь намеренно не закрепляется.

## Полный пример

```yaml
version: 1
strict: true

repositories:
  - id: sdd-specs
    roles: [store]
    remote: https://example.test/sdd-specs.git
    default_branch: main

  - id: frontend
    roles: [code]
    remote: https://example.test/frontend.git
    default_branch: main

extensions: {}
```

## `version`

Обязательное поле. Alpha v1 принимает только `version: 1`; любое другое значение или отсутствие поля — ошибка `CONFIG_INVALID`.

## `strict`

| Поле | Назначение |
|---|---|
| `strict` | Project default для Git-гарантий Core. Значение `true` используется по умолчанию, включая старые конфиги без этого поля. `false` включает relaxed mode для всех Core-команд. |

Флаг `--no-strict` временно включает relaxed mode для одного вызова и имеет приоритет над project default. Обратного флага нет: Core не переходит в strict поверх `strict: false` и никогда не ослабляет режим автоматически после ошибки strict-проверки.

В strict mode Core проверяет Git identity, origin, основную ветку и чистоту, клонирует отсутствующие Code Repositories и сохраняет workspace в `.openspec-orch/state.json`. В relaxed mode Core не клонирует репозитории, не проверяет Git remote/branch/clean state и маркирует ревизии как `unpinned`.

| Команда | Strict | Relaxed |
|---|---|---|
| `init` | Создаёт проект с `strict: true`. | `--no-strict` сохраняет `strict: false` как project default. Сам `init` всё равно читает Git URL и текущую default branch центрального репозитория для обязательной конфигурации Store. |
| `connect` | Клонирует отсутствующие Code Repositories и проверяет их Git-состояние. | Использует только уже существующие `<workspace>/src/<repository-id>` и не вызывает Git для их проверки. |

Рекомендуемая и проверенная версия — OpenSpec `1.7.0`. Это рекомендация документации, а не exact pin: Core проверяет semantic version CLI, фактически вызываемые команды и обязательные поля их JSON-ответов.

## `repositories`

`repositories` — список репозиториев проекта. В нём должен быть ровно один репозиторий с `roles: [store]` и могут быть перечислены репозитории с `roles: [code]`.

| Поле | Назначение |
|---|---|
| `repositories[].id` | Устойчивый идентификатор репозитория в lowercase kebab-case. Используется в командах и в имени файла Cycle Record независимо от имени локального каталога. |
| `repositories[].roles` | Singleton-массив: `[store]` для центральных спецификаций или `[code]` для реализации. Другие формы (multi-role, пустой массив) отклоняются. |
| `repositories[].remote` | Сетевой Git URL репозитория. Встроенные в HTTP(S)-URL логин и пароль, `file://` и локальные абсолютные пути запрещены. |
| `repositories[].default_branch` | Основная ветка репозитория, относительно которой выполняются `connect` и `repository status`. |

Идентификаторы репозиториев не должны повторяться. Репозиторий с `roles: [store]` — единственный источник Cycle Records (`.openspec-orch/changes/`) и Master Specs. Репозитории с `roles: [code]` реализуют принятые изменения; `assign` принимает в состав Cycle только их — сам Store не может быть членом Cycle.

## `extensions`

Свободная секция для расширений вне Alpha v1 контракта Core. Core не интерпретирует её содержимое. В строгом режиме любое поле верхнего уровня вне `version`, `strict`, `repositories`, `extensions` — ошибка `CONFIG_INVALID`; это относится и к секциям `agent`/`handoffs` предыдущего прототипа.

## Редактирование

YAML-комментарии допустимы и не влияют на разбор файла. При ручном изменении сохраняйте имена полей и их структуру: Orchestrator Core выполняет строгую проверку конфигурации до запуска проектных операций.
