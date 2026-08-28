# Project Template

Project Template — copy-only каталог, который `openspec-orch init` один раз безопасно
накладывает на результат штатного OpenSpec init. Он не выбирает Agent, Extension или
Plugin.

## Что поставляет Base Template

- schema `base-v1`: `intake → proposal → specs → design → tasks`;
- `openspec/config.yaml`;
- заготовки project context и ADR;
- `.gitignore` из явного asset mapping.

Команды, skills, bootstrap instructions и subagent принадлежат отдельному bundled
Extension `openspec-base` и активируются нативным механизмом выбранного Agent.

Change Tracking не входит в Base Template как обязательный Plugin. Его Apply context
поставляется Store-scoped Extension самого Plugin и активируется при подключении
`change-tracking` к Store.

OpenSpec Graph также не выбирается Template. Полный описанный workflow
`openspec-base` вызывает Graph после появления Delta Specs и перед Apply, поэтому для
этого маршрута пользователь отдельно инициализирует Plugin и связывает его со Store.

## Работа с субагентом

Для точечной проверки текущего кода `openspec-base` вызывает отдельного субагента только для
чтения. Он не планирует изменение и отвечает на один вопрос по одному репозиторию.

- Один вопрос — один новый субагент. Пять вопросов означают пять независимых
  субагентов; их контекст не переиспользуется. Вопрос по нескольким репозиториям
  основной агент сначала разделяет по репозиторию.
- Каждый субагент возвращает один структурированный ответ. Технические подтверждения
  остаются в результате проверки, а в описание изменения попадает только итоговый
  вывод без внутренних деталей кода.
- Проверка кода допустима на Design, Tasks и Apply либо для подтверждения конфликта с
  текущим состоянием. На Intent, Intake, Proposal и Specs она не используется.

## Границы владения

| Владелец | Содержимое |
|---|---|
| OpenSpec | Официальный agent pack, schema lifecycle и operations |
| Core | Безопасное одноразовое копирование объявленных Template assets |
| Project Template | Context, custom schema/config и дополнительные assets |
| Extension | Instructions, commands, skills, subagents, hooks и простые MCP |
| Plugin | Runtime, repository lifecycle и Plugin-contributed Extension |

Встроенные `openspec-*` skills и `opsx-*` commands выбранного provider нельзя
переписывать Project Template. Project-local правила используют свой namespace.

## Жизненный цикл

Template применяется только во время `init`. Скопированные файлы принадлежат Store и
автоматически не обновляются. Повторный `init` не перезаписывает отличающийся
target-файл и не управляет Plugins.

Явный `--template` полностью заменяет Base Template. Автоматического merge двух
Project Templates нет.

## Минимальный custom Template

```text
team-template/
├── template.yaml
├── context/
└── assets/
```

```yaml
id: team-product
name: Team Product Template
copy:
  - from: context
    to: openspec/context
  - from: assets/gitignore.template
    to: .gitignore
```

Применение:

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --extension openspec-base \
  --template /absolute/path/to/team-template
```

Identity custom Template берётся из `template.yaml`; source path после применения не
сохраняется. Agent definition выбирается отдельно из distribution-owned каталога.

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

## Plugin-owned Extension

Plugin может вернуть один или несколько data-only Extension с package-relative root и
Store/Repository target. Core передаёт их тому же Agent Adapter, который обслуживает
standalone Extensions. Автоматического поиска или применения `template/` внутри
Plugin Package нет.
