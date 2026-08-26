# Project Template

Project Template — локальный каталог, который `openspec-orch init` безопасно
накладывает на результат штатного OpenSpec init. Он задает процесс проекта, но не
добавляет бизнес-логику в Core.

## Что поставляет Base Template

- mappings для Qwen, GigaCode и Claude;
- schema `base-v1`: `intake → proposal → specs → design → tasks`;
- `/openspec-base-intake` и `/openspec-base-context`;
- skills `base-intent`, `openspec-base-meta-planning`,
  `openspec-base-apply-context`, `openspec-base-test-cases`;
- read-only `openspec-base-repository-evidence-scout`;
- заготовки project context и ADR;
- required Plugin `openspec-graph`.

Change Tracking не входит в Base Template как обязательный Plugin. Его Apply context
поставляется собственным Plugin Template и появляется только после установки
`change-tracking`.

## Границы владения

| Владелец | Содержимое |
|---|---|
| OpenSpec | Официальный agent pack, schema lifecycle и operations |
| Core | Безопасное копирование, mapping/routing и разрешение required Plugin ID |
| Project Template | Project rules, context, commands, skills и subagents |
| Plugin Template | Только Plugin-specific Store/Agent assets |

Встроенные `openspec-*` skills и `opsx-*` commands выбранного provider нельзя
переписывать Project Template. Project-local правила используют свой namespace.

## Жизненный цикл

Template применяется только во время `init`. Скопированные файлы принадлежат Store и
автоматически не обновляются. Повторный `init` выполняет reconciliation required
Plugins, но не перезаписывает отличающийся target-файл.

Явный `--template` полностью заменяет Base Template. Автоматического merge двух
Project Templates нет.

## Минимальный custom Template

```text
team-template/
├── template.yaml
└── AGENT.md
```

```yaml
requires:
  plugins:
    - openspec-graph

agents:
  team-agent:
    openspec_adapter: provider-adapter
    generated_directory: .provider
    target_directory: .team-agent
    commands_directory: .team-agent/commands
    instructions_file: AGENT.md
    copy:
      - from: AGENT.md
        to: AGENT.md
```

Применение:

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent team-agent \
  --template /absolute/path/to/team-template
```

## Agent mapping

| Поле | Назначение |
|---|---|
| `openspec_adapter` | Значение штатного `openspec init --tools` |
| `generated_directory` | Каталог официального pack OpenSpec |
| `target_directory` | Итоговый provider-specific каталог |
| `commands_directory` | Каталог официальных commands |
| `instructions_file` | Постоянный корневой файл инструкций |
| `handoffs` | Необязательные именованные paths Template |
| `copy` | Упорядоченные операции `from → to` |

Если generated и target directories различаются, Core переносит официальный pack, а
затем применяет copy operations. Смысл канонических skills/subagents хранится один
раз; provider adapter может менять только несовместимый frontmatter.

## Безопасность применения

Core запрещает:

- выход target path за корень Store;
- запись в `.git/`, `.openspec-store/` и `openspec-orch.yaml`;
- symlink и специальные файлы;
- file/directory collision;
- неизвестные поля `template.yaml`;
- перезапись существующего отличающегося файла.

Interpolation, conditions, delete rules и автоматическое удаление старых assets не
реализованы.

## Plugin Template

Plugin может содержать `template/template.yaml` с `agents.<id>.copy`. Base mapping
повторять не нужно. Если Plugin не объявляет явную Agent contribution, Core применяет
его Template через тот же safe copy engine во время `plugin init`.

При `plugin remove` доставленные файлы не удаляются автоматически. CLI возвращает
Store-relative paths для контролируемой ручной очистки.
