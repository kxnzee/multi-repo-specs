# Пользовательский Project Template

Project Template — обычный локальный каталог, который `openspec-orch init` накладывает поверх результата штатного `openspec init`. Он определяет project-local обвязку команды, но не добавляет команды в Orchestrator Core и не изменяет внутреннюю логику OpenSpec.

## Граница ответственности

| Слой | Ответственность |
|---|---|
| OpenSpec | Схемы, Changes, Specs, artifact graph и штатные `opsx-*` commands/skills |
| Orchestrator Core | `openspec-orch` commands, безопасное копирование Template, Store/repository routing, режимы и технические проверки |
| Project Template | Agent mapping, skeleton, project-local schema/config, commands, skills, subagents, инструкции, роли и процесс команды |
| Orchestrator Plugins | Будущие дополнительные capabilities Core, например интеграция с Jira; Template сможет определять, где они используются |

Связь однонаправленная: Template использует публичные точки расширения OpenSpec и сохраняемый контракт Core; Plugin в будущем будет расширять только Core. OpenSpec ничего не знает об оркестраторе.

## Создание из базового Template

Из checkout репозитория скопируйте поставляемую базовую директорию:

```bash
cp -R harness/templates/base ../team-template
```

После копирования удалите ненужные project files и согласованно измените оставшиеся инструкции. Например, если команда не использует `CODEOWNERS`, удалите его из `skeleton/` и уберите ссылки на него из собственных инструкций. Core не требует этот файл и не проверяет смысловую целостность процесса Template.

Передайте выбранный каталог только при первом `init`:

```bash
openspec-orch init /absolute/path/to/store \
  --store payments-specs \
  --agent qwen \
  --template /absolute/path/to/team-template
```

Пользовательский Template полностью заменяет базовый; автоматического смешивания нет. После успешного `init` скопированные файлы принадлежат проекту, исходный Template больше не нужен для команд Core.

## Минимальный Template

Минимальная структура для OpenSpec adapter `qwen`:

```text
team-template/
├── template.yaml
└── QWEN.md
```

`template.yaml`:

```yaml
agents:
  qwen:
    openspec_adapter: qwen
    generated_directory: .qwen
    target_directory: .qwen
    commands_directory: .qwen/commands
    instructions_file: QWEN.md
    copy:
      - from: QWEN.md
        to: QWEN.md
```

`QWEN.md` может содержать минимальные постоянные инструкции команды:

```markdown
# Project instructions

Follow the project OpenSpec configuration and the user's explicit request.
```

Ключ `qwen` внутри `agents` является значением `--agent`. Штатный `openspec init` создаёт `generated_directory`, Core при необходимости переносит его в `target_directory`, после чего выполняет `copy` сверху вниз. В примере официальный pack уже создаёт `.qwen/commands`, а Template добавляет обязательный `instructions_file`.

Core не требует context pack, `CODEOWNERS` или другие файлы базового Template. Для обнаружения готового Store нужны только Core metadata/config и штатный `openspec/config.yaml`; дополнительные файлы проверяет лишь та команда, чей handoff их использует.

## Поля agent mapping

| Поле | Назначение |
|---|---|
| `openspec_adapter` | Adapter, передаваемый штатному `openspec init --tools` |
| `generated_directory` | Каталог, создаваемый OpenSpec adapter |
| `target_directory` | Итоговый provider-specific каталог проекта |
| `commands_directory` | Каталог agent commands после применения Template |
| `instructions_file` | Основной файл постоянных инструкций агента |
| `handoffs` | Необязательные пути к Template-инструкциям, вызываемым конкретными Core-командами |
| `copy` | Упорядоченный список копирований `from -> to` относительно Template и Store |

Поддерживаемая Core архитектура сейчас — Markdown commands. Имя директории Template, названия `skeleton`, `commands`, `skills` или `agents` и префиксы agent-facing файлов Core не задаёт.

## Необязательные handoffs

Handoff объявляется только если команда хочет использовать соответствующую помощь Core:

```yaml
handoffs:
  explore: .team/instructions/explore.md
  apply: .qwen/commands/team-apply.md
```

`connect` и независимые команды не требуют этих файлов. `openspec-orch explore` лениво проверит `explore`, а `openspec-orch load` — `apply`. Core сохраняет пути в `openspec-orch.yaml`, но не интерпретирует содержимое и не требует конкретного префикса.

## Собственная OpenSpec schema

Template может скопировать `openspec/config.yaml` и project-local schema обычными `copy` operations:

```yaml
copy:
  - from: skeleton
    to: .
```

```text
skeleton/
└── openspec/
    ├── config.yaml
    └── schemas/
        └── team-flow/
            └── schema.yaml
```

Template имеет приоритет над файлами, созданными OpenSpec в рамках текущего `init`, поэтому может осознанно заменить agent-specific или OpenSpec project files. Совместимость такого набора остаётся ответственностью автора Template. Изменение project-local schema после `init` не требует изменения Core или повторного `init`.

## Ограничения минимального механизма

- Template не является npm-пакетом и не имеет собственной версии или lifecycle.
- Нет interpolation, conditions, delete rules, merge, hooks и автоматического update.
- Явный Template не объединяется с базовым.
- Существующий до запуска отличающийся project file не перезаписывается: конфликт разрешает пользователь.
- Template не может писать в `openspec-orch.yaml`, `.openspec-store/`, `.git/` или за пределы target.
- Symlink, специальные файловые объекты, небезопасные пути и file-directory collisions отклоняются.
- Ненужные файлы, созданные самим OpenSpec, пользователь после `init` удаляет вручную.

Обновление Orchestrator Core или совместимого OpenSpec выполняется независимо и не перегенерирует уже установленный Template. Если команде нужна другая конфигурация процесса, она может хранить несколько каталогов Template и передавать нужный путь при создании нового Store.
