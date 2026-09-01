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
Code Repositories. Verify не выполняет Release или Archive.

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

Merge нескольких Templates, interpolation, conditions, delete rules и автоматическая
миграция уже созданного Store не поддерживаются. Core сохраняет в
`openspec-orch.yaml` только ID применённого Template, а не путь к его source; храните
исходный Custom Template отдельно для будущих reviewable миграций.
