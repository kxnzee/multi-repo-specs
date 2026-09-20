# Создание своих дополнений

`openspec-orch create` — команда Orchestrator для авторов. Она поставляется с
Orchestrator, работает без Store и настроенного агента и создаёт самостоятельную
папку. Существующий каталог не перезаписывается. Команда не устанавливает
зависимости, не подключает пакет к проекту и не публикует его.

| Что нужно добавить | Тип | Основное содержимое |
|---|---|---|
| Инструкции или навык для агента | Extension | Текст в SKILL.md |
| Исполняемую команду или интеграцию | Plugin | JavaScript на публичном SDK |
| Начальные документы и контекст проекта | Template | Копируемые файлы |

## Что понадобится

Установленный Orchestrator с командой `create`, Node.js и Git согласно
[требованиям установки](installation-and-updates.md). Для создания папки дополнения
не нужен Store. Для подключения результата нужен отдельный тестовый Store;
для проверки Extension — настроенный агент, выбранный в этом Store.

Создавайте исходники дополнения в своей рабочей папке или отдельном репозитории.
Добавлять файлы в исходный код Orchestrator, менять Core или встроенный каталог
для этого не требуется. Самостоятельный пакет подключается через `--from`.

Общий порядок: создать → заполнить → проверить → подключить к тестовому проекту
→ проверить поведение → передать команде.

## Через агента

Из тестового Store подключите поставляемое расширение:

```bash
openspec-orch extension init create-addon
openspec-orch extension connect create-addon
openspec-orch extension status create-addon
```

Откройте новую сессию агента и попросите использовать навык `create-addon`,
например: «Создай расширение для проверки требований на полноту». Агент поможет
выбрать тип, вызовет CLI, заполнит содержимое и выполнит проверки. Способ прямого
вызова навыка зависит от клиента; единой slash-команды для всех агентов нет.

## Самостоятельное создание

```bash
openspec-orch create extension requirements-review ./requirements-review \
  --name "Проверка требований" --agent claude --target store
openspec-orch create plugin dependency-audit ./dependency-audit --profile commands
openspec-orch create template team-project ./team-project
```

Для Extension повторяйте `--agent` и `--target` при необходимости. Без флагов
объявляются все агенты поставки и target `store`. Служебные файлы общего native
протокола создаются комплектом; фактическую поддержку определяет `extension.yaml`.
Редактируйте `skills/<id>/SKILL.md` и общий `agent-instructions.md`.

Для Plugin профиль `commands` создаёт исполняемый пример `inspect`.
`repository` создаёт lifecycle connect/status и command grammar; `native` также
создаёт runtime в `bin/`. Последние два профиля требуют реализации обработчиков,
что явно указано в README. `--support store --support code` выбирает роли,
`--extension` добавляет Plugin-owned Extension. Существующий `plugin register`
остаётся доступным.

Минимальный Template копирует `context/` в `openspec/context/` и устанавливает
инструкции выбранного агента из `assets/agent-instructions.md`. Он полностью
заменяет копируемое содержимое default и не наследует его схемы или Extensions.
Для нового Store передайте абсолютный путь пакета через `openspec-orch init
<store-path> --store <id> --agent <agent-id> --template <template-path>`.

## Какие файлы заполнять

| Тип | Файлы автора | Что добавить |
|---|---|---|
| Extension | `skills/requirements-review/SKILL.md` | Когда применять навык, входные данные, действия, формат результата и способ проверки |
| Extension | `agent-instructions.md` | Общие инструкции агенту и условия обращения к навыку |
| Plugin | `index.js` | Логику команды через публичный Plugin SDK; для repository/native также connect/status |
| Native Plugin | `bin/` | Исполняемую логику отдельного runtime |
| Template | `context/README.md` | Назначение проекта, пользователей и подтверждённые ограничения |
| Template | `assets/agent-instructions.md` | Как агенту использовать контекст проекта |
| Template | `template.yaml` | Дополнительные источники и места копирования, если стартового набора недостаточно |

Пути в таблице соответствуют примерам выше. В созданном Extension сохраните YAML
frontmatter навыка с полями `name` и `description`, заменив описание конкретной
задачей. Например, для проверки требований укажите: «Найди непроверяемые условия;
верни таблицу с проблемой и уточняющим вопросом; не придумывай бизнес-правила».

Созданные технические файлы уже согласованы между собой. Их можно изменять при
необходимости, но после изменения descriptor, манифестов или путей повторите
проверку. Стартовый Plugin `inspect` подтверждает загрузку примера; свою полезную
логику нужно реализовать самостоятельно или с помощью агента.

## Проверка после редактирования

```bash
openspec-orch create validate ./requirements-review --kind extension
openspec-orch create validate ./dependency-audit --kind plugin
openspec-orch create validate ./team-project --kind template
```

Проверяются обычные файлы без symlinks (служебные `.git` и `node_modules` не
обходятся), frontmatter навыков, контракты пакетов и манифесты Extensions.
Для Template строится реальный план копирования для каждого агента поставки,
включая отсутствующие источники и защищённые пути. Для Plugin проверяются manifest
и entrypoint. Синтаксис JavaScript проверяется для Plugin и Extension, включая hooks.
Произвольные ссылки внутри текста не проверяются, команды hooks не исполняются.

Для проверки export и command grammar Plugin сначала установите его зависимости
и запустите contract test из папки пакета:

```bash
npm install
npm test
openspec-orch create validate . --kind plugin --load
```

`--load` импортирует JavaScript Plugin в отдельном процессе с ограничением времени.
Это не песочница; actions команд не вызываются. Досрочный выход процесса без
завершения contract check считается ошибкой. Проверка не подтверждает реализацию
connect/status и не проверяет все динамические Plugin-owned Extensions.

После успешной структурной проверки выполните сценарий по README пакета в отдельном
тестовом Store. Для Extension проверьте подключение и работу в новой сессии агента;
для Plugin — результат команды и lifecycle; для Template — созданный Store.
Готовность структуры, подключение и прикладное поведение — отдельные результаты.

## Добавить результат в проект

В примерах ниже замените `/absolute/path/to/...` на свои абсолютные пути.
Исходная папка дополнения и тестовый Store — разные каталоги. Не запускайте
`plugin init` или `extension init` из папки пакета: эти команды меняют состав Store.

### Extension

После создания и заполнения `requirements-review` перейдите в тестовый Store
с выбранным Claude:

```bash
cd /absolute/path/to/test-store
openspec-orch extension init requirements-review --from /absolute/path/to/requirements-review
openspec-orch extension connect requirements-review
openspec-orch extension status requirements-review
openspec-orch doctor
```

Откройте новую сессию Claude в этом Store и дайте навыку два требования: одно с
неоднозначной формулировкой, другое с конкретными критериями приёмки. Проверьте,
что первое приводит к уточняющим вопросам, а второе — к подтверждению проверяемости.
Наличие регистрации Extension само по себе не подтверждает качество ответа.

### Plugin

Для примера `dependency-audit` с профилем `commands`:

```bash
cd /absolute/path/to/test-store
openspec-orch plugin init --plugin dependency-audit --from /absolute/path/to/dependency-audit
openspec-orch plugin exec dependency-audit inspect
```

Этот профиль не требует привязки к репозиторию. Если вы выбрали `repository`
или `native`, сначала реализуйте обработчики, а затем подключите Plugin к
зарегистрированному репозиторию. Вместо `frontend` укажите его ID:

```bash
openspec-orch plugin connect dependency-audit --repo frontend
openspec-orch plugin status --plugin dependency-audit --repo frontend
openspec-orch plugin exec --repo frontend dependency-audit inspect
```

`inspect` создаётся для профилей `commands` и `repository`. Для `native` передайте
команду, которую реализовали в `bin/`. Проверьте результат на входных данных своей
задачи; вывод стартового примера не доказывает готовность прикладной логики.

### Template

Template применяется при создании нового Store:

```bash
openspec-orch init /absolute/path/to/new-store --store team-specs --agent claude --template /absolute/path/to/team-project
```

Проверьте появление `openspec/context/README.md` и `CLAUDE.md` в новом Store.
Повторный `init` не обновляет файлы уже существующего Store. Для изменений
существующего проекта используйте [порядок обновления Template](../templates/development.md).

### Обновление и передача

Для повторной установки изменённого внешнего пакета используйте явное обновление
из Store, затем повторите подключение:

```bash
openspec-orch extension update requirements-review --from /absolute/path/to/requirements-review
openspec-orch extension connect requirements-review --refresh
```

У Plugin обновление выполняется через `plugin update`; дальнейшие действия зависят
от его профиля и lifecycle. Полный порядок обновления, отключения и удаления описан
в [руководстве подключения](../plugins/operations.md). Перед передачей результата
коллегам замените локальный источник закреплённой поставкой, как описано ниже.

## Автоматический вызов

Подкоманды `create` работают без интерактивных вопросов. Добавьте `--json` для
единственного JSON-ответа: успех возвращает код 0, ошибка — код 1 и поля
`error.code` / `error.message`. Без `--json` ошибки аргументов возвращают код 2,
ошибки выполнения — код 1.
Справка `openspec-orch create --help` и версия `openspec-orch --version` выводят текст.

Результат создания содержит `kind`, `id`, `root`, `editable`, `validation` и `next`.
`next.command` и `next.args` передавайте инструменту запуска как отдельные аргументы,
не интерполируйте пользовательский путь в shell. Результат проверки перечисляет
`checks`. Поле `behavior` всегда равно `"not-tested"`: эта команда не выполняет
прикладной сценарий и не хранит результаты ручных или модельных проверок.

Из checkout команда запускается как `node src/bin/openspec-orch.js create`.

## Передача команде

Для Plugin и Extension проверьте `npm pack --dry-run`, затем подготовьте tarball,
точную npm-версию или Git revision. Установку через `--from` выполняйте из Store,
указывая путь или закреплённый источник пакета. При изменении Extension повышайте
версию пакета и native manifests. Порядок подключения и обновления описан в
[операционном руководстве](../plugins/operations.md).
