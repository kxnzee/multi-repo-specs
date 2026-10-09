# Работа с Change

Change описывает одну доработку продукта: зачем она нужна, как меняются требования, что
сделать в каждом репозитории и как подтверждён результат. Change проходит четыре
этапа. На каждом этапе принимается своё решение и нужно своё подтверждение.

| Этап | Где | Что получается | Документ |
|---|---|---|---|
| 1. Planning | Store-сессия | Intake, Proposal, Delta Specs, Design, Tasks; принятое решение по плану | [Planning](planning.md) |
| 2. Apply | Сессия в каждом назначенном репозитории кода | Код, проверки репозитория, отмеченные задачи | [Apply](apply.md) |
| 3. Verify | Store-сессия | `verify.md` и решение человека `PASS` или `FAIL` | [Verify](verify.md) |
| 4. Archive | Store-сессия | Принятая дельта перенесена в Master Specs | [Archive](archive.md) |

```text
Planning ──принят──▶ Apply ──кандидат собран──▶ Verify ──PASS──▶ Archive
    ▲                  │                          │
    └─ изменился scope ┘◀──── дефект или drift ───┘
```

## Команды агента

Orchestrator доставляет в Store и репозитории кода команды OpenSpec. В Claude они
вызываются через двоеточие, в Qwen и GigaCode через дефис:

| Действие | Claude | Qwen, GigaCode |
|---|---|---|
| Исследовать вопрос без изменений | `/opsx:explore` | `/opsx-explore` |
| Подготовить следующий артефакт | `/opsx:continue <change-id>` | `/opsx-continue <change-id>` |
| Реализовать задачи | `/opsx:apply <change-id>` | `/opsx-apply <change-id>` |
| Проверить результат | `/opsx:verify <change-id>` | `/opsx-verify <change-id>` |
| Архивировать | `/opsx:archive <change-id>` | `/opsx-archive <change-id>` |

Состояние Change в любой момент:

```bash
openspec status --change <change-id>
openspec instructions <artifact> --change <change-id>
```

Порядок артефактов и правила каждого шага задаёт schema Change. Orchestrator и
плагины параллельного процесса не создают.

## Выбор schema

Schema выбирается при создании Change и потом не меняется. Обе поддерживают
несколько репозиториев.

| Schema | Когда выбирать | Порядок артефактов |
|---|---|---|
| `spec-driven-extended` | Нужно уточнить требования, согласовать решение, разбить работу на проверяемые задачи и принять результат | Intake → Proposal → Specs и Design → Tasks → Apply → Verify |
| `superspec-multirepo` | Агенту нужен строгий подробный порядок: одобренный Brainstorm, исполняемые Tasks, изолированная рабочая копия, TDD, промежуточные ревью, Process Compliance в Verify | Brainstorm → … по schema. Единственный план лежит в `tasks.md`, отдельного `plan.md` нет |

Если порядок выбранной schema перестал подходить, создайте новый Change и
перенесите в него только принятый смысл.

## Правила, общие для всех этапов

- Требования, Change и Master Specs лежат в Store, а код и его проверки в
  репозиториях кода.
- Исследование кода даёт факты, но не принимает продуктовых решений и не расширяет
  scope.
- Агент собирает подтверждения, но решения принимает человек.
- Архивирование не выполняется автоматически и не разрешает выпуск.
- Если команда приняла [процесс работы над Jira Story](../story-delivery-process.md),
  он задаёт ветки, PR, роли и контрольные точки поверх этих этапов.
