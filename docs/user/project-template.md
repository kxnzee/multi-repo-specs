# Project Template

Project Template — copy-only каталог, который `openspec-orch init` один раз безопасно
накладывает на результат штатного OpenSpec init. Он не выбирает Agent или Plugin, но
может объявить обязательный совместимый Extension-профиль через `requires.extensions`.

## Bundled Project Templates

| ID | Required Extension | Schema | Назначение |
|---|---|---|---|
| `base` | `openspec-base` | `base-v1` | Product-first Intake, Planning, multi-repository Gates и внешний verification checkpoint |
| `superspec` | `superpowers` | `superspec-multirepo` | Полный Superspec lifecycle с multi-repository Apply, Verify и Finalize |

Без `--template` используется `base`. `superspec` полностью заменяет его и не
наследует Base-specific Intake, instructions или skills.

### Base Template

- schema `base-v1`: `intake → proposal → specs → design → tasks`;
- `openspec/config.yaml`;
- заготовки project context и ADR;
- `.gitignore` из явного asset mapping.

Команды, skills, bootstrap instructions и subagent принадлежат отдельному bundled
Extension `openspec-base` и активируются нативным механизмом выбранного Agent. Base
декларативно требует его: init блокирует снятие выбора и добавляет Extension
автоматически в flag mode. Общий MCP gateway не входит в Project composition и
устанавливается отдельно командой `openspec-orch agent setup` в user scope.

Base Template и `openspec-base` Extension не обнаруживают и не вызывают конкретные
Plugins. Change Tracking и OpenSpec Graph поставляют собственные application/CLI
capabilities и подключаются независимо от Template; встроенный MCP читает их только
когда соответствующий Plugin доступен.

### Superspec Template

Superspec использует pipeline
`brainstorm → proposal → optional design → specs → tasks → plan → apply → verify →
finalize`. Schema сохраняет полный skill-driven цикл: brainstorming, writing-plans,
worktrees, subagent-driven TDD, task/final review, systematic debugging, fresh
verification и structured branch closeout. `apply.md`, `verify.md` и `finalize.md`
делают handoff и convergence loop проверяемыми.

Template и Extension сохраняют раздельное владение: `superspec` декларативно
требует только `superpowers`. В интерактивном init порядок такой:

```text
Store ID → Project Template → Agent → Extensions → Code Repositories
→ strict mode → итоговое подтверждение
```

После выбора `superspec` required Extension уже отмечен и заблокирован. В flag mode
он добавляется автоматически, поэтому достаточно:

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --template superspec
```

Upstream single-repository Git automation адаптирована, а не удалена: Finalize
вызывает `superpowers:finishing-a-development-branch` отдельно в каждом затронутом
Code Repository после явной авторизации и записывает выбранный outcome. Внешняя
проверка текущей версии и реальный Release gate остаются обязательными и не
подменяются Agent Verify.

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

Явный bundled ID полностью заменяет default `base`. Автоматического merge двух
Project Templates нет. Строка в форме lowercase kebab-case трактуется как bundled
ID и при отсутствии в каталоге отклоняется. Относительный локальный путь указывайте
с `./`, например `--template ./team-template`.

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
