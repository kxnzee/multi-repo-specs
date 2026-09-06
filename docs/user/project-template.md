# Project Template

Project Template — copy-only пакет project-local конфигурации, context, schemas и
assets. Он не выполняет hooks или произвольный код. При первом `openspec-orch init`
Core сначала подготавливает штатный OpenSpec Agent pack, затем копирует файлы
выбранного Template и записывает переносимую конфигурацию проекта.

Template не владеет `openspec-orch.yaml`, Store identity, Plugins или Agent gateway.
Встроенные OpenSpec skills `openspec-*` и команды `opsx-*` также создаются самим
OpenSpec; Template и standalone Extensions не должны подменять их.

## Template по умолчанию

Bundled Template `default` копирует в Store:

- `STORE.md` — общую точку входа для работы со спецификациями;
- файл выбранного агента (`CLAUDE.md`, `QWEN.md` или `GIGACODE.md`), направляющий к `STORE.md`;
- `openspec/config.yaml`;
- долговечный project context в `openspec/context/`;
- schemas `spec-driven-extended` и `superspec-multirepo` со всеми templates;
- `.gitignore` для локального состояния Orchestrator и Agent.

Descriptor `default` требует standalone Extensions `spec-driven-extended` и
`superpowers`. `init` добавляет их в project composition независимо от выбранного
Agent и не позволяет отключить через `--no-extensions`. Их payload не является частью
copy-only файлов Template: Extensions имеют собственный lifecycle.

Plugins и user-scoped Agent gateway в Template не входят. Их подключают отдельно
после создания Store.

`STORE.md` относится к центральному Store. Он не содержит инструкции разработки
Orchestrator и не заменяет schemas или Extensions. Исходники находятся в
`templates/default/assets/STORE.md` и `assets/agent-instructions.md`.
Существующий файл агента с другим содержимым блокирует первый init; он не
перезаписывается. Для уже созданного Store новые файлы переносятся вручную через
проверяемый Store PR: повторный init не обновляет Template.

## Выбор Template и Extensions

Без `--template` используется bundled Template `default`. В TTY `init` показывает
каталог, а в non-TTY требует как минимум `--store` и `--agent`:

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --template default
```

Дополнительные standalone Extensions выбираются повторяемым `--extension`. Они не
становятся частью Template и сохраняются отдельными declarations в
`openspec-orch.yaml`. Обязательные Extensions выбранного bundled Template всегда
добавляются к этому списку.

## Выбор schema

Один Store может содержать Changes с разными schemas. OpenSpec сохраняет выбор в
`.openspec.yaml` конкретного Change:

```bash
openspec new change update-copy --schema spec-driven-extended
openspec new change redesign-checkout --schema superspec-multirepo
```

| Schema | Зависимости artifacts и действий |
|---|---|
| `spec-driven-extended` | Intake → Proposal → Specs + Design → Tasks → Apply → Verify |
| `superspec-multirepo` | Brainstorm → Proposal → Specs → Tasks → Plan → Apply → Verify; Design опционален после Brainstorm |

Знак `+` означает, что перед Tasks нужны оба artifact. Apply — штатное действие
OpenSpec, а не отдельный файл. Доступность Verify в графе зависимостей artifacts не
доказывает, что реализация выполнена: сначала нужен Apply candidate и фактическое
evidence. Точный следующий шаг всегда определяйте через актуальные OpenSpec
`status` и `instructions`; если одновременно разрешено несколько artifacts, один из
них выбирает человек.

Не переключайте schema уже созданного Change. Если её граф зависимостей больше не
подходит, создайте новый Change и перенесите только принятый смысл.

Обе schemas используют одну Feature Acceptance: Agent собирает evidence, человек
явно принимает решение `PASS` или `FAIL`, а до решения gate остаётся `PENDING`.
Change Tracking не участвует в этом решении: он связывает OpenSpec tasks с revisions
Code Repositories. Verify не выполняет Archive, UAT или Release. После `PASS` команда
публикует Archive через Store PR, затем проводит UAT и принимает отдельное
Release-решение.

## Команды и skills workflow

Все шесть точек входа Extension имеют метку `[spec-driven-extended]` в описании.
Квадратные скобки в подсказке аргументов обозначают необязательный ввод; сами скобки
вводить не нужно. Если обязательных для работы данных нет в диалоге, агент уточнит их.

| Имя | Тип | Аргументы | Результат |
|---|---|---|---|
| `spec-driven-extended-intent` | skill | `[описание изменения]` | Intent в диалоге, без записи файлов |
| `spec-driven-extended-intake` | command | `[change-id]` | Intake и рекомендуемый следующий шаг |
| `spec-driven-extended-context` | command | `[initialize\|audit\|update]` и selectors | Аудит контекста либо согласованный diff |
| `spec-driven-extended-meta-planning` | skill | `[change-id] [stage]` | Проверка Planning без записи и принятия Gate |
| `spec-driven-extended-apply-context` | skill | `[change-id]` | Проверенный scope для штатного Apply |
| `spec-driven-extended-test-cases` | skill | `[change-id]` | Тест-кейсы по принятым требованиям |

Режимы `stage`: `proposal`, `specs`, `design`, `tasks`, `impact-review`,
`planning-review`. Последние два — режимы проверки, а не OpenSpec artifact ID.
Selectors контекста: `--change <change-id>`, повторяемые `--spec <capability-path>`
и `--domain <domain-path>`.

В Qwen команды вызываются как `/spec-driven-extended-intake`; skills доступны через
меню skills или прямой вызов по имени в поддерживающих его версиях.
GigaCode использует Qwen-совместимую поставку; доступность прямого вызова skills
зависит от версии клиента. В Claude Plugin добавляет namespace, например
`/spec-driven-extended:spec-driven-extended-intent` и
`/spec-driven-extended:spec-driven-extended-intake`.
Подсказка `argument-hint` предназначена для поддерживающих её клиентов;
точное отображение меню определяется клиентом.

Штатный OpenSpec использует `/opsx-continue`, `/opsx-explore`, `/opsx-apply` в
Qwen/GigaCode и `/opsx:continue`, `/opsx:explore`, `/opsx:apply` в Claude.
Это разные варианты вызова одного workflow. Правила регистрации описаны в
[документации Qwen](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
и [Claude Plugins](https://code.claude.com/docs/en/plugins).

## Владение и обновление

После успешного `init` скопированные файлы принадлежат Store. Повторный `init`
распознаёт существующий Project, не применяет Template заново и не требует исходный
каталог Custom Template. Он не обновляет и не перезаписывает скопированные assets.

Совместимые изменения инструкций Template переносятся в Store отдельным проверяемым
PR по [процедуре миграции](installation-and-updates.md). Если меняется граф
зависимостей schema, которую используют активные Changes, не заменяйте его под тем же
ID. Оставьте прежнюю schema под прежним ID, установите новую под новым ID и выбирайте
её только для новых Changes. Старую schema удаляйте отдельным изменением Store после
завершения и Archive всех зависимых Changes.

## Custom Template

Локальный Template состоит из `template.yaml` и файлов-источников. Descriptor требует
уникальный lowercase kebab-case `id`, непустой `name` и хотя бы одну операцию `copy`:

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

```bash
openspec-orch init /absolute/path/to/store \
  --store specs \
  --agent qwen \
  --template /absolute/path/to/team-template
```

Custom Template полностью заменяет copy payload `default`, но не штатный OpenSpec
Agent pack, выбранный Agent или Core config. Автоматическое закрепление обязательных
Extensions поддерживает bundled catalog; для локального Custom Template передавайте
нужные standalone Extensions явно через `--extension`. Не полагайтесь на
`requires.extensions` локального descriptor: он проверяется как metadata, но не
добавляет и не блокирует Extensions при выборе `init`.

Путь Template должен существовать отдельно от target Store; эти каталоги не могут
совпадать или содержать друг друга. `copy.from` принимает обычный файл или каталог,
а `copy.to` — относительный POSIX path внутри Store. Каталог копируется рекурсивно с
сохранением file mode.

Copy engine запрещает:

- path traversal и замену корня Store;
- запись в `.git/`, `.openspec-store/` и `openspec-orch.yaml`;
- запись в защищённые пути Agent pack;
- symlinks, специальные файлы и file-directory collisions;
- регистронезависимые collisions;
- перезапись существующего файла с отличающимся содержимым.

Необязательное поле descriptor `agentInstructions: assets/agent-instructions.md`
обозначает один обычный файл внутри Template. Он копируется без преобразований
в `instructionsFile` выбранного Agent; имена провайдеров не задаются в Template.
Это отдельное разрешение только для этого файла: обычный `copy` по-прежнему не
может писать в защищённые Agent paths, skills или команды. Без `agentInstructions`
файл агента не создаётся Template. Существующее идентичное содержимое сохраняется;
конфликт или появление файла после preflight останавливает установку без перезаписи.

Merge нескольких Templates, interpolation, conditions, delete rules и автоматическая
миграция уже созданного Store не поддерживаются. Core сохраняет в
`openspec-orch.yaml` только ID применённого Template, а не путь к его source; храните
исходный Custom Template отдельно для будущих reviewable миграций.
