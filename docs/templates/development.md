# Разработка шаблонов

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

`openspec/context/` хранит бизнес-знания. Поле `context` в `openspec/config.yaml`
имеет другое назначение: это общие инструкции OpenSpec для создания артефактов.
Schemas задают состав, зависимости и требования артефактов, Extensions — процедуры
работы агента. Поэтому вызов skill в schema может быть нужен, а в бизнес-описании — нет.

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

Структура и порядок наполнения контекста описаны в
[руководстве по бизнес-контексту](../user/project-context.md): бизнес-архитектура — в
`03-architecture.md`, применимые ограничения кибербезопасности — в
`05-constraints.md`, проверяемые обязательства продукта — в Specs.

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

## Источники правил

`openspec/config.yaml.schema` задаёт только схему по умолчанию. Граф, пути артефактов,
допустимое исследование кода и проверки стадий задаёт выбранная schema; общие
инструкции не должны повторять список установленных схем и их этапы.
Template не создаёт отдельный процесс команды. Роли, согласования, ветки и направления
PR используются только из явно предоставленных правил проекта; schema и Extensions
не должны придумывать их по должностям или структуре репозиториев.

## Выбор schema

Шаблон добавляет доступные схемы, но не определяет порядок работы с Change. Выбор
схемы, переходы между этапами, проверки и последующие Archive, UAT и Release
описаны в [сценариях Change](default.md#сценарии-работы-с-change).
Один Store может содержать Changes с разными схемами; их выбор сохраняется в
`.openspec.yaml` конкретного Change.

## Команды и skills workflow

Все шесть точек входа Extension имеют метку `[spec-driven-extended]` в описании.
Квадратные скобки в подсказке аргументов обозначают необязательный ввод; сами скобки
вводить не нужно. Если обязательных для работы данных нет в диалоге, агент уточнит их.

| Имя | Тип | Аргументы | Результат |
|---|---|---|---|
| `spec-driven-extended-intent` | skill | `[описание изменения]` | Intent в диалоге, без записи файлов |
| `spec-driven-extended-intake` | command | `[change-id]` | Intake и рекомендуемый следующий шаг |
| `spec-driven-extended-context` | command | `[initialize\|update]` и selectors | Инициализация или дополнение общего контекста |
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
PR по [процедуре миграции](../user/installation-and-updates.md). Если меняется граф
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

По запросу на реализацию агент сначала вызывает штатный OpenSpec Apply через
механизм skills/commands своего провайдера. Внутри Apply schema
`spec-driven-extended` он вызывает `spec-driven-extended-apply-context` до изменения
кода. Helper проверяет scope; прямой вызов helper передаёт управление штатному
Apply и не разрешает самостоятельную реализацию. MCP Apply Context и tracking
не заменяют вызов штатного Apply.

Scout не содержит правил конкретных плагинов. Основной агент передаёт ему
применимые инструкции навигации через `code_navigation`; scout соблюдает первый
шаг, ограничения и fallback. При отсутствии специальных правил используется
адресное чтение anchors. Правило «сначала CodeGraph» и его передача исполнителю
принадлежат CodeGraph Extension. Это общий контракт для Claude, Qwen и GigaCode.
Во всех поставляемых шаблонах Verify каждый сценарий принятой области Change
превращается в воспроизводимый ручной кейс: предусловия и действия проверяющего,
наблюдаемый ожидаемый результат, короткое подтверждение агента и отдельное решение
человека. Для интерфейса указывается экран, для API — запрос, для базы данных —
подготовка и проверяемое состояние. Сам Verify остаётся краткой выжимкой: candidate
указывается одной локальной ссылкой на канонический реестр, а SHA, история веток,
timestamps, сырые логи, ответы API и рассуждения агента в него не копируются.
Конкретные revisions, provider URL и подготовку checkout берёт на себя Change
Tracking; Verify не копирует хеши и ссылки на PR/CI из его реестра. Основное
evidence читается из Store и checkout кандидата через `repository_id` и
относительный путь к результату или тесту. Если кандидат не удалось разрешить,
агент ставит `BLOCKED`, а не восстанавливает его через API хостинга. Доступ к
GitHub, GitLab или Bitbucket API/MCP для понимания Verify не требуется.

`PASS` требует результата выполненной проверки на указанном candidate; нарушение
требования — `FAIL`, отсутствие или устаревание подтверждения — `PENDING`,
неприменимость — `N/A` с причиной. Если Delta Specs обоснованно отсутствуют, агент
формирует короткие ненормативные `Acceptance case` из принятых критериев Proposal,
не подменяя их Tasks, Design или историей Git. Для межрепозиторных сценариев
проверяется взаимодействие версий, а не только отдельные репозитории. Пропуски,
`FAIL` и применимые `PENDING` не позволяют объявлять результат принятым.
В `initiative` ревью планирования не подтверждает исполнение сценариев: без
свидетельств поставленного результата они остаются `PENDING`. Решение о приёмке
остаётся за человеком по правилам проекта.

Новые шаблоны Verify должны включать общий блок `SCENARIO_VERIFICATION_CONTRACT_V1`;
проверка поставки обходит все Templates и схемы без фиксированного списка имён.
Verify в схемах default заполняется по-русски; команды, идентификаторы и значения
статусов сохраняются.
`NOT_APPLICABLE` в разделе «Соблюдение процесса» относится к TDD, worktrees и выбору
implementation review workflow; обязательный scout и Planning review сохраняются.

Проверка результата сверяет
покрытие с принятым контрактом, включая default и значимые недопустимые входы.
Meta-planning проверяет фактического родителя каждого Scenario по Delta Specs;
успешная структурная OpenSpec validation не заменяет эту смысловую проверку.
В Verify записывается только краткий результат strict validation текущего Change и
локальный путь к evidence; stdout команды и диагностика окружения туда не
переносятся. Human gate и будущие Archive/UAT/Release остаются отдельно от evidence.
