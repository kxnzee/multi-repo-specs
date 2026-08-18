# Пользовательский Project Template

Project Template — обычный локальный каталог, который `openspec-orch init` накладывает поверх результата штатного `openspec init`. Он определяет project-local обвязку команды, но не добавляет команды в Orchestrator Core и не изменяет внутреннюю логику OpenSpec.

## Граница ответственности

| Слой | Ответственность |
|---|---|
| OpenSpec | Схемы, Changes, Specs, artifact graph и штатные `opsx-*` commands/skills |
| Orchestrator Core | `openspec-orch` commands, безопасное копирование Template, Store/repository routing, режимы и технические проверки |
| Project Template | Agent mapping и явно выбранные bootstrap-файлы; пользовательский Template также может добавлять schema/config, команды, skills, subagents и правила команды |
| Orchestrator Plugins | Будущие дополнительные capabilities Core, например интеграция с Jira; Template сможет определять, где они используются |

Связь однонаправленная: Template использует публичные точки расширения OpenSpec и сохраняемый контракт Core; Plugin в будущем будет расширять только Core. OpenSpec ничего не знает об оркестраторе.

## Создание из базового Template

Из checkout репозитория скопируйте поставляемую базовую директорию:

```bash
cp -R templates/base ../team-template
```

Базовый Template устанавливает только общий bootstrap-набор: постоянные инструкции
выбранного агента, `.gitignore` для локального state, универсальный context pack,
project-local `openspec/config.yaml` со штатной schema `spec-driven` и дополнительными
правилами Planning, четыре русскоязычных project skills, одна native команда
для контекста (`/openspec-base-context`) и пять нативных read-only subagents. Они не
зависят от Orchestrator-команд, Store registry, конкретной структуры
репозиториев или ролей прежнего SDD-процесса.

Передайте выбранный каталог только при первом `init`:

```bash
openspec-orch init /absolute/path/to/store \
  --store payments-specs \
  --agent <agent-id> \
  --template /absolute/path/to/team-template
```

Пользовательский Template полностью заменяет базовый; автоматического смешивания нет. После успешного `init` скопированные файлы принадлежат проекту, исходный Template больше не нужен для команд Core.

Выберите `<agent-id>` в [едином списке поддерживаемых агентов](supported-agents.md).
Остальная пользовательская документация не зависит от конкретного провайдера.

Базовый Template хранит один набор постоянных инструкций, skills и смысловых
профилей subagents. Agent mapping копирует совместимые источники напрямую, а
необходимые нативные преобразования берёт из `templates/base/adapters/<agent-id>/`.
Core не интерпретирует и не преобразует содержимое этих файлов.

## Минимальный Template

Минимальная структура для произвольного OpenSpec adapter:

```text
team-template/
├── template.yaml
└── AGENT.md
```

`template.yaml`:

```yaml
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

`AGENT.md` может содержать минимальные постоянные инструкции команды:

```markdown
# Project instructions

Follow the project OpenSpec configuration and the user's explicit request.
```

Ключ `team-agent` внутри `agents` является значением `--agent`. Штатный
`openspec init` создаёт `generated_directory`, Core при необходимости переносит его
в `target_directory`, после чего выполняет `copy` сверху вниз. Официальный pack
создаёт каталог commands, а Template добавляет обязательный `instructions_file`.

Базовый Template не устанавливает `CODEOWNERS`. Он сохраняет
штатную schema `spec-driven`, но добавляет в `openspec/config.yaml` project context и
artifact rules для опросника Proposal, Delta Specs, стабильных Scenario ID, Design и
Tasks. Context pack является обычным набором project files, а project skills и native
команды находятся рядом с официальными OpenSpec extensions и не изменяют их.

`openspec-orch.yaml` остаётся единственным реестром точных repository identity.
Context pack добавляет `system-map.yaml`: он описывает общую ответственность,
системы и межсистемные контракты, не копируя remotes, branches и локальное устройство
Code Repositories. Структура модулей и классов, версии технологий, локальные
API/config-параметры, команды build/test/lint, CI и упаковка остаются в файлах
инструкций и других источниках соответствующего Code Repository. Planning rules
требуют раздельный Repository impact в Proposal, implementation map в Design и Tasks
по каждому id. Requirements и Scenarios продолжают описывать capability, а не
структуру Git-репозиториев.

Все поставляемые базовым Template команды, skills и subagents используют namespace
`openspec-base-*`. Штатные артефакты, созданные `openspec init`, сохраняют namespace
`openspec-*`, а произвольный пользовательский Template может выбрать собственный.

Базовый контекстный контракт:

- `/openspec-base-context` — команда для инициализации, аудита и актуализации
  долговечного project context;

Базовые skills:
- `openspec-base-apply-context` — preflight штатного Apply: подтверждает текущий
  repository-id и Cycle, проверяет принятую planning revision и выбирает только
  принадлежащие репозиторию sections Tasks; перед каждым `[x]` требует task-level
  evidence (реальный artifact и выполненную проверку), а при незакрытой задаче не
  разрешает объявить repository Result завершённым;
- `openspec-base-planning-check` — read-only маршрутизация проверки текущего
  Planning-артефакта к минимальному набору специализированных skills и subagents;
- `openspec-base-analyze-impact` — read-only анализ влияния Change;
- `openspec-base-review-change` — read-only ревью Proposal, Delta Specs, Design и Tasks:
  проверяет полноту затронутых `repository-id`, межрепозиторные контракты,
  трассируемость и готовность к человеческому Gate;
- `openspec-base-test-cases` — список трассируемых тест-кейсов без автоматической записи
  нештатного файла внутри Change.

Subagents устанавливаются в нативный каталог, заданный agent mapping. Вложенные
каталоги внутри итоговой `agents/` не используются: назначение выражается через
namespace в имени, чтобы не зависеть от поддержки nested discovery конкретным
provider.

### OpenSpec-сабагенты

Их имена всегда начинаются с `openspec-base-`. Встроенный OpenSpec skill остаётся
владельцем workflow и файлов; эти subagents нативно выполняют только ограниченное
read-only исследование и возвращают evidence в текущую сессию:

- `openspec-base-project-context-researcher`;
- `openspec-base-architecture-impact-reviewer`;
- `openspec-base-implementation-scout`;
- `openspec-base-specification-reviewer` — независимое ревью спеки и матрицы покрытия
  репозиториев;
- `openspec-base-verification-reviewer`.

### Общие project subagents

Префикс `openspec-base-` зарезервирован за OpenSpec-профилями базового Template.
Общие project subagents используют namespace проекта. Базовый Template сейчас их не
добавляет; проект может добавить такие профили через собственный Template.

Core не запускает их и не сохраняет ответы. Для обнаружения готового Store он
по-прежнему требует только metadata/config, штатный `openspec/config.yaml`, каталог
команд официального agent pack и `instructions_file`.

Для Apply разработчик открывает персональный OpenSpec Workset с Code Repository
первым member и Store вторым. Штатный `/opsx:apply <change-id>` получает skills из
подключённого Store, а `openspec-base-apply-context` ограничивает запуск текущим
repository section без изменения встроенной команды.

Если Code Repositories используют `colbymchenry/codegraph`, настройте его как MCP
server с alias `codegraph`. Базовые subagents уже содержат read-only allowlist его
поисковых инструментов и используют обычный read/search как fallback. Индекс остаётся
локальным в каждом Code Repository; инструкции приведены в
[справочнике CodeGraph](codegraph.md).

## Поля agent mapping

| Поле | Назначение |
|---|---|
| `openspec_adapter` | Adapter, передаваемый штатному `openspec init --tools` |
| `generated_directory` | Каталог, создаваемый OpenSpec adapter |
| `target_directory` | Итоговый provider-specific каталог проекта |
| `commands_directory` | Каталог agent commands после применения Template |
| `instructions_file` | Основной файл постоянных инструкций агента |
| `handoffs` | Необязательные именованные пути пользовательского Template; текущие команды их не вызывают |
| `copy` | Упорядоченный список копирований `from -> to` относительно Template и Store |

Поддерживаемая Core архитектура сейчас — Markdown commands. Имена source-директорий
Template и префиксы agent-facing файлов Core не задаёт.

## Собственная OpenSpec schema

Template может скопировать `openspec/config.yaml` и project-local schema обычными `copy` operations:

```yaml
copy:
  - from: project-files
    to: .
```

```text
project-files/
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
- Неизвестные поля `template.yaml` отклоняются, чтобы опечатка не превращалась в скрыто проигнорированную настройку.
- Symlink, специальные файловые объекты, небезопасные пути и file-directory collisions отклоняются.
- Ненужные файлы, созданные самим OpenSpec, пользователь после `init` удаляет вручную.

Обновление Orchestrator Core или совместимого OpenSpec выполняется независимо и не перегенерирует уже установленный Template. Если команде нужна другая конфигурация процесса, она может хранить несколько каталогов Template и передавать нужный путь при создании нового Store.
