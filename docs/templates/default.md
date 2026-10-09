# Template default

Template `default` задаёт стартовый набор Store для обычной работы: доработки продукта
в одном или нескольких репозиториях кода. Для общей инициативы нескольких команд
без управления их разработкой используйте [`initiative`](initiative.md).

Создание Store с этим шаблоном описано в
[создании нового проекта](../user/new-project.md). Работа с Change по этапам описана в
[пользовательской документации](../user/change/README.md).

## Что копируется в Store

| Источник | Куда | Назначение |
|---|---|---|
| `context/` | `openspec/context/` | Каркас [бизнес-контекста](../user/project-context.md) |
| `openspec/config.yaml` | `openspec/config.yaml` | Общие правила OpenSpec для артефактов и Archive |
| `openspec/schemas/` | `openspec/schemas/` | Schemas `spec-driven-extended` и `superspec-multirepo` |
| `assets/gitignore.template` | `.gitignore` | Исключения для локального состояния |
| `assets/agent-instructions.md` | `CLAUDE.md`, `QWEN.md` или `GIGACODE.md` | Корневые инструкции агента |

Обязательные Extensions: `project-context`, `spec-driven-extended`, `superpowers`.
Плагины шаблон не устанавливает.

После `init` скопированные файлы принадлежат команде. Повторный `init` их не
обновляет; изменения переносятся отдельным проверяемым изменением Store по
[миграции Store](../user/maintenance.md#миграция-store).

## Schemas

| Schema | Когда выбирать |
|---|---|
| `spec-driven-extended` | Уточнить требования, согласовать решение, разбить работу на проверяемые задачи и принять результат. Порядок: Intake → Proposal → Specs и Design → Tasks → Apply → Verify |
| `superspec-multirepo` | Строгий подробный порядок для агента: одобренный Brainstorm, исполняемые Tasks, изолированная рабочая копия, TDD, промежуточные ревью, Process Compliance в Verify. Единственный план лежит в `tasks.md` |

Schema выбирается при создании Change и сохраняется в его `.openspec.yaml`. Один
Store может содержать Changes с разными schemas. Подробности шагов есть в
[Planning](../user/change/planning.md), [Apply](../user/change/apply.md),
[Verify](../user/change/verify.md) и [Archive](../user/change/archive.md).

В `spec-driven-extended` правила состава Intake и Design находятся в шаблонах
schema (`templates/intake.md`, `templates/design.md`), а правило сверки
артефактов описано в навыке `spec-driven-extended-reconcile` Extension
`spec-driven-extended`. `openspec/config.yaml` копий этих правил не содержит.

## Изменение процесса проекта

Если меняются порядок или зависимости артефактов, а в Store есть активные Changes,
сохраните старую schema под прежним ID и добавьте новую под новым ID только для
новых Changes. Формат шаблонов и порядок их разработки описаны в
[руководстве для разработчика шаблонов](development.md).
