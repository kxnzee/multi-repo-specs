# Пользовательский Project Template

Project Template — обычный локальный каталог, который `openspec-orch init` накладывает поверх результата штатного `openspec init`. Он определяет project-local обвязку команды, но не добавляет команды в Orchestrator Core и не изменяет внутреннюю логику OpenSpec.

## Граница ответственности

| Слой | Ответственность |
|---|---|
| OpenSpec | Схемы, Changes, Specs, artifact graph и штатные `opsx-*` commands/skills |
| Orchestrator Core | `openspec-orch` commands, безопасное копирование Template, Store/repository routing, режимы и технические проверки |
| Project Template | Agent mapping и явно выбранные bootstrap-файлы; пользовательский Template также может добавлять schema/config, команды, skills, subagents и правила команды |
| Orchestrator Plugins | Независимые CLI-адаптеры, которые пользователь выбирает из Plugin-каталога и явно связывает с repositories |

Template и Plugins не зависят друг от друга: Template применяется во время bootstrap,
а Plugin имеет собственный lifecycle `init → connect → status` и repository scope.
Plugin может установить собственные MCP и инструкции для Agent ID, сохранённого при
bootstrap, не читая и не изменяя исходный Template. OpenSpec ничего не знает об обоих
механизмах.

## Создание из базового Template

Из checkout репозитория скопируйте поставляемую базовую директорию:

```bash
cp -R templates/base ../team-template
```

Базовый Template устанавливает только общий bootstrap-набор: постоянные инструкции
выбранного агента, `.gitignore` для локального state, универсальный context pack,
project-local `openspec/config.yaml` со штатной schema `spec-driven` и дополнительными
правилами Planning, четыре русскоязычных project skills, одна native команда
для контекста (`/openspec-base-context`) и три нативных read-only subagents. Template
не требует существующего Cycle для установки: Orchestrator используется только в
тех режимах, где нужен repository scope или точный реестр Code Repositories. При
неиспользуемом Orchestrator обычный OpenSpec workflow остаётся доступным, а ошибки
существующего Cycle или repository identity не превращаются в неявный fallback.

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
Template добавляет `openspec/graph.yaml`, а Store-only Plugin `openspec-graph`
проецирует единую иерархию Store → Repository → Master Spec → Change → Delta Spec.
Store и Repository берутся из реестра Orchestrator, Change и Specs — непосредственно
из стандартной структуры OpenSpec. Операции `ADDED`, `MODIFIED`, `REMOVED`,
`RENAMED` выводятся из Delta Specs автоматически; в `graph.yaml` вручную фиксируются
только подтверждённые типизированные связи с существующим Store-relative `path:line`
evidence.

Граф OpenSpec не индексирует функции, классы, вызовы внутри одного Code Repository
и не читает `.codegraph/`. Эта плоскость принадлежит CodeGraph. Структура кода,
локальные API/config-параметры, команды build/test/lint, CI и упаковка остаются в
Code Repository. Planning rules требуют раздельный Repository impact в Proposal,
implementation map в Design и Tasks по каждому id. Requirements и Scenarios
продолжают описывать capability, а не структуру Git-репозиториев.

Поставляемые базовым Template расширения OpenSpec используют namespace
`openspec-base-*`. Самостоятельный skill `base-intent` является намеренным
исключением: он формулирует Intent до Planning и не оркестрирует OpenSpec workflow.
Штатные артефакты, созданные `openspec init`, сохраняют namespace `openspec-*`, а
произвольный пользовательский Template может выбрать собственный.

Базовый контекстный контракт:

- `/openspec-base-context` — команда для инициализации, аудита и актуализации
  долговечного project context. Это единственное исключение вне meta-skill: команда
  может вызвать только context researcher и repository evidence scout.

Базовые skills:

- `base-intent` — русскоязычная фасилитация Intent перед Planning: помогает уточнить
  тип изменения, Why Now, ожидаемое улучшение, критерии успеха, ограничения и риски,
  после чего формирует Daily Intent Brief. Skill не создаёт Change и не изменяет
  файлы;
- `openspec-base-meta-planning` — единственный meta-skill и единая read-only точка
  входа для стадий `proposal`, `specs`, `design`, `tasks`, `impact-review` и
  `planning-review`. Он выбирает минимальный набор проверок и может маршрутизировать
  Planning subagents и leaf-skill тест-кейсов, но не изменяет артефакты и не принимает
  человеческий Gate;
- `openspec-base-apply-context` — выбирает режим штатного Apply: только при
  `CYCLE_NOT_FOUND` предлагает standard OpenSpec Apply без Orchestrator либо создание
  Cycle; при существующем Cycle подтверждает его scope через OpenSpec Graph,
  проверяет planning revision и выбирает только принадлежащие репозиторию sections
  Tasks. Внутри текущего Code Repository использует CodeGraph как необязательную
  навигацию с fallback на адресный read/search. Перед каждым `[x]` требует task-level
  evidence, а при незакрытой задаче не разрешает объявить repository Result
  завершённым;
- `openspec-base-graph-maintenance` — проверяет, пересобирает или точечно обновляет
  подтверждённые явные связи `openspec/graph.yaml`, не изменяя Specs, Changes, Cycle
  или CodeGraph и не создавая связи без Store-relative evidence;
- `openspec-base-test-cases` — список трассируемых тест-кейсов без автоматической записи
  нештатного файла внутри Change.

`base-intent`, `openspec-base-apply-context`, `openspec-base-graph-maintenance` и
`openspec-base-test-cases` являются leaf-skills:
основной агент или пользователь может выбрать их напрямую, но они не вызывают
project skills, commands или subagents. Только `openspec-base-meta-planning` может
оркестрировать Planning-проверки; рекурсивный вызов meta-skill запрещён.

Subagents устанавливаются в нативный каталог, заданный agent mapping. Вложенные
каталоги внутри итоговой `agents/` не используются: назначение выражается через
namespace в имени, чтобы не зависеть от поддержки nested discovery конкретным
provider.

### OpenSpec-сабагенты

Их имена всегда начинаются с `openspec-base-`. Встроенный OpenSpec skill остаётся
владельцем workflow и файлов; эти subagents нативно выполняют только ограниченное
read-only исследование и возвращают evidence в текущую сессию:

- `openspec-base-project-context-researcher` — отвечает на один ограниченный вопрос
  по подтверждённому продуктовому или доменному контексту центрального Store и не
  открывает Code Repositories;
- `openspec-base-planning-reviewer` — независимо проверяет одну стадию Planning или
  полный Change по уже разрешённым артефактам и evidence bundle;
- `openspec-base-repository-evidence-scout` — собирает evidence для одного вопроса,
  одного `repository-id` и одной точной Git revision в одном Code Repository.

Subagents являются leaf-артефактами: они не вызывают skills, commands или других
agents и не являются пользовательскими точками входа. Их вызывает meta-skill;
команда `/openspec-base-context` может вызвать только context researcher и repository
evidence scout. Межрепозиторный вывод всегда собирает основной агент, не смешивая
evidence разных репозиториев и revisions.

### Общие project subagents

Префикс `openspec-base-` зарезервирован за OpenSpec-профилями базового Template.
Общие project subagents используют namespace проекта. Базовый Template сейчас их не
добавляет; проект может добавить такие профили через собственный Template.

Core не запускает их и не сохраняет ответы. Для обнаружения готового Store он
по-прежнему требует только metadata/config, штатный `openspec/config.yaml`, каталог
команд официального agent pack и `instructions_file`.

## Безопасное определение Code Repository

Путь к checkout принимается только из разрешённого root текущего runtime/workset,
явного абсолютного пути пользователя или результата
`openspec-orch repository status --repo <repository-id>`. Агент не ищет workspace,
`src` или репозитории обходом `/`, домашнего каталога, родителя Store либо соседних
каталогов и не читает `.openspec-orch/state.json` напрямую. Если путь не предоставлен
или не прошёл проверку, repository-specific исследование блокируется до получения
одного точного пути либо выполнения пользователем `openspec-orch connect`.

Перед запуском repository evidence scout основной агент канонизирует путь,
подтверждает Git root и точный `repository-id`, получает полный commit SHA, проверяет,
что `HEAD` равен этой revision, а working tree чист. Scout возвращает blocker, если
любое обязательное поле отсутствует или проверка не пройдена; он не ищет другой
checkout и не выходит в родительские или соседние каталоги.

## Взаимодействие с пользователем

Когда требуется выбор или уточнение, постоянные инструкции требуют предлагать 2–4
конкретных взаимоисключающих варианта с краткими последствиями. Обоснованно лучший
вариант помечается как рекомендуемый; если evidence недостаточно, варианты остаются
нейтральными. Пользователь всегда может ответить номером, коротким подтверждением
или написать собственный вариант. Разрешение на запись, удаление или внешнее действие
не помечается как рекомендуемое и не выбирается по умолчанию.

Без Cycle штатный `/opsx:apply <change-id>` предлагает standard OpenSpec Apply либо
переход к `openspec-orch assign`. В standard-режиме встроенная команда работает без
repository scope и Snapshot Orchestrator. При существующем Cycle разработчик открывает
персональный OpenSpec Workset с Code Repository первым member и Store вторым, а
`openspec-base-apply-context` ограничивает запуск текущим repository section без
изменения встроенной команды.

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
