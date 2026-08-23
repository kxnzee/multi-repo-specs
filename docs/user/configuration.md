# Конфигурация `openspec-orch.yaml`

Справочник описывает текущий формат `version: 3`. Другие версии не мигрируются
автоматически и отклоняются строгой схемой вместе с секциями `agent`/`handoffs`,
старым `extensions` и полями `role`/`url` предыдущего прототипа.

`openspec-orch.yaml` находится в корне центрального Store Repository и описывает режим Core и репозитории проекта. Файл создаётся командой `openspec-orch init` и используется командами Core как машинная конфигурация. Версия OpenSpec здесь намеренно не закрепляется.

## Полный пример

```yaml
version: 3
strict: true

agents:
  - qwen

plugins:
  - id: secret-scanner
    source: "@company/openspec-plugin-secret-scanner@1.0.0"
  - id: dependency-audit
    source: "@company/openspec-plugin-dependency-audit@1.2.0"

repositories:
  - id: sdd-specs
    roles: [store]
    remote: https://example.test/sdd-specs.git
    default_branch: main
    plugins: []

  - id: frontend
    roles: [code]
    remote: https://example.test/frontend.git
    default_branch: main
    plugins:
      - secret-scanner
      - dependency-audit
```

В примере к одному `frontend` подключены два независимых Plugin. Их пакеты сначала
выбираются через `openspec-orch plugin init`, а связи с репозиторием создаются через
`openspec-orch plugin connect`.

## `version`

Обязательное поле. Поддерживается только `version: 3`. Любое другое значение или
отсутствие поля — ошибка `CONFIG_INVALID`; скрытой миграции прежних форматов нет.

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

## `agents`

`agents` — уникальный список Agent ID, зарегистрированных успешным
`openspec-orch init --agent <agent-id>`. Поле принадлежит проектной конфигурации и
не заменяет mapping в Project Template: mapping определяет bootstrap-файлы, а список
фиксирует, для каких агентов Plugin с Agent integration должен установить свои MCP и
инструкции.

Обычный пользователь не редактирует список вручную. `init` регистрирует один Agent ID;
Plugin с Agent integration использует его для установки MCP и инструкций. Проект без
зарегистрированного Agent завершит `plugin init` ошибкой
`PLUGIN_AGENT_NOT_REGISTERED`, не создавая частичной установки.

## `repositories`

`repositories` — список репозиториев проекта. В нём должен быть ровно один репозиторий с `roles: [store]` и могут быть перечислены репозитории с `roles: [code]`.

| Поле | Назначение |
|---|---|
| `repositories[].id` | Устойчивый идентификатор репозитория в lowercase kebab-case. Используется в командах и в имени файла Cycle Record независимо от имени локального каталога. |
| `repositories[].roles` | Singleton-массив: `[store]` для центральных спецификаций или `[code]` для реализации. Другие формы (multi-role, пустой массив) отклоняются. |
| `repositories[].remote` | Сетевой Git URL репозитория. Встроенные в HTTP(S)-URL логин и пароль, `file://` и локальные абсолютные пути запрещены. |
| `repositories[].default_branch` | Основная ветка репозитория, относительно которой выполняются `connect` и `repository status`. |
| `repositories[].plugins` | Plugin ID, уже подключённые к этому Repository. Каждый ID должен присутствовать в верхнеуровневом `plugins`. |

Идентификаторы репозиториев не должны повторяться. Репозиторий с `roles: [store]` — единственный источник Cycle Records (`.openspec-orch/changes/`) и Master Specs. Репозитории с `roles: [code]` реализуют принятые изменения; `assign` принимает в состав Cycle только их — сам Store не может быть членом Cycle.

## `plugins`

Верхнеуровневый `plugins` — список деклараций `{ id, source }` для Plugin, выбранных
через `plugin init`. `source` содержит точную package identity, которую Core использует
для последующей загрузки. Декларация не связывает Plugin с Repository сама по себе.
Фактическая связь хранится в
`repositories[].plugins`, поэтому один Plugin можно подключить к нескольким
репозиториям, а к одному репозиторию — несколько Plugin.

`extensions` в текущем формате не допускается. Template-данные здесь не хранятся:
Project Template применяется
один раз во время `init`, а Plugins имеют отдельный каталог и lifecycle.

## Редактирование

YAML-комментарии допустимы и не влияют на разбор файла. При ручном изменении сохраняйте имена полей и их структуру: Orchestrator Core выполняет строгую проверку конфигурации до запуска проектных операций.
