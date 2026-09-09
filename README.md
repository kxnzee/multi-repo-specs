# OpenSpec Orchestrator

OpenSpec Orchestrator — обвязка (harness) для работы ИИ-агентов в нескольких репозиториях.
Он обеспечивает агента контекстом, подключает
инструменты и рабочие процессы, а с помощью Change Tracking сохраняет проверяемую связь
задач OpenSpec с коммитами, содержащими реализацию.

Это локальный CLI с MCP-интерфейсом и адаптерами для Claude, Qwen и GigaCode.
Команда хранит требования и правила работы в центральном OpenSpec Store,
подключает репозитории кода и при необходимости Store других команд.

## Что даёт обвязка

| Задача | Возможность |
|---|---|
| Дать агенту общий контекст проекта | Store со спецификациями, Changes, бизнес-контекстом и реестром репозиториев; доступ через MCP |
| Подготовить рабочее окружение | `init` создаёт Store, `connect` подключает репозитории и доставляет агентские команды и Extensions |
| Выбрать процесс под задачу | Настраиваемые схемы OpenSpec и навыки для планирования, реализации и Verify |
| Понять влияние изменения | OpenSpec Graph показывает связи требований, Changes и репозиториев; CodeGraph помогает исследовать код |
| Зафиксировать результат реализации | Change Tracking связывает выполненные задачи с коммитами кодовых репозиториев |
| Найти проблемы настройки | `doctor` проверяет окружение и подключения, сообщает причины ошибок |

Harness здесь — сочетание контекста, инструментов, инструкций и проверок вокруг
агента. Взаимодействием с моделью, сессиями и разрешениями на использование инструментов
управляет CLI выбранного агента. Часть правил проверяется программно, часть задаётся схемами
и навыками; наличие артефактов само по себе не доказывает качество реализации.
Требованиями и жизненным циклом артефактов управляет OpenSpec. За ревью, CI,
развёртывание, приёмку, выпуск и архивирование изменений отвечает команда.

## Репозитории и расширяемость

В каждом проекте один основной Store. К нему можно подключить:

- `code` — репозитории реализации с контекстом и инструментами агента;
- `specs` — Store других команд для чтения требований и просмотра их графов.

Для репозитория с ролью `specs` создаётся отдельная рабочая копия. Его кодовые репозитории,
вложенные Store и пакеты не разворачиваются; Extensions в него не устанавливаются.
Поэтому руководитель может работать с требованиями нескольких команд без их кода.
Задачи между командами автоматически не передаются.

**Template** задаёт начальные файлы контекста и схемы, **Extension** добавляет
агентские навыки и инструкции, **Plugin** — исполняемые инструменты CLI/MCP.
Скопированные схемы принадлежат Store: команда может адаптировать их и подключать
свои расширения. Подробнее — [конфигурация](docs/user/configuration.md) и
[Project Template](docs/user/project-template.md).

## Требования

- Node.js 22.16.0 или новее;
- npm и Git;
- OpenSpec CLI в `PATH`.

Перед `connect` установите CLI выбранного агента и проверьте его доступность:
`claude --version`, `qwen --version` или `gigacode --version`.
Для запросов к модели нужен настроенный доступ в этом CLI.
Change Tracking требует OpenSpec `>=1.11.0 <2`; в примере установки закреплена 1.11.0.

## Установка для пилота

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm install --global @fission-ai/openspec@1.11.0
npm link
openspec-orch --help
```

Для пилота версию фиксируют тегом или коммитом Git. Обновление, восстановление
после прерывания и миграция Store описаны в [руководстве по установке и обновлению](docs/user/installation-and-updates.md).

Версия формата `openspec-orch.yaml` не изменяется без явной инструкции владельца
Store. В частности, обновление Orchestrator не является разрешением повышать значение поля
`version` или автоматически мигрировать конфигурацию: при несовместимости нужно
остановиться и отдельно согласовать целевую версию и миграцию.

## Быстрый старт

Пример ниже создаёт новый Store для команды с двумя кодовыми репозиториями.
Замените пути и адреса удалённых Git-репозиториев своими. Store должен быть отдельным обычным
каталогом; не запускайте `init` в исходниках
Orchestrator или репозитории кода.

```bash
mkdir -p /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs

openspec-orch init . \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main

openspec-orch connect
openspec-orch doctor
```

`connect` клонирует отсутствующие кодовые репозитории в `<workspace>/src/`.
Существующие рабочие копии он не обновляет через `git pull`. Результат `files_changed`
означает, что при подключении созданы файлы настройки. Сохраните их по процессу команды.
Созданные файлы Store также сохраните в Git согласно процессу команды.

Если Store уже существует, **клонируйте его и выполните `connect`**, затем `doctor`;
повторный `init` не нужен. Внешние плагины и расширения восстанавливаются из
зафиксированного файла зависимостей (lockfile). Явная команда восстановления:

```bash
openspec-orch package sync
```

Подключение к существующему проекту и нестандартное расположение каталогов — в
[руководстве по началу работы](docs/user/getting-started.md).

## Какой процесс выбрать

| Сценарий | Схема | Особенность |
|---|---|---|
| Задача достаточно понятна, нужен прямой путь от уточнения к реализации | `spec-driven-extended` | Intake → Proposal → Specs + Design → Tasks → Apply → Verify |
| Нужно исследовать варианты и подробно спланировать реализацию | `superspec-multirepo` | Процесс на базе Superpowers: Brainstorm → Proposal → Specs → Tasks → Plan → Apply → Verify |
| Нужно согласовать общий результат нескольких команд без кодового Apply | `initiative` | Proposal → Specs → Verify |

Template `default` устанавливает первые две схемы и Extensions
`spec-driven-extended` и `superpowers`. Схема выбирается для каждого Change отдельно
из каталога Store:

```bash
openspec new change update-copy --schema spec-driven-extended
openspec new change redesign-checkout --schema superspec-multirepo
```

Для нового Store с инициативами выберите `--template initiative` при `init`.
Добавление профиля в существующий Store и настройка под организацию описаны в
[руководстве инициатив](docs/user/initiatives.md). Профиль помогает планировать
и проверять подтверждения результата; он не создаёт дочерние изменения автоматически.
Подробные правила выбора и согласований — в
[руководстве по схемам](docs/user/project-template.md#выбор-schema).

## Agent gateway

Для доступа агента к контексту и инструментам Orchestrator через MCP один раз
установите gateway:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Затем перезапустите агента и откройте сессию в Store или подключённом кодовом
репозитории. Во всех примерах `qwen` можно заменить на `claude` или `gigacode`.
Gateway устанавливается для пользователя и используется несколькими проектами.
Удаление: `openspec-orch agent remove --agent qwen`. Обновление и диагностика
устаревших установок описаны в [руководстве обновлений](docs/user/installation-and-updates.md).

## Plugins

Плагины не устанавливаются шаблоном проекта (Template); их подключают явно:

| Plugin | Назначение |
|---|---|
| `openspec-graph` | Проверка связей Store, изменений, спецификаций и репозиториев, граф в браузере и доступ через MCP; поддерживает `store` и `specs` |
| `codegraph` | Локальная навигация по коду выбранного репозитория |
| `change-tracking` | Связь задач OpenSpec с коммитами кодовых репозиториев |

Пример:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch plugin exec openspec-graph inspect --json
openspec-orch plugin exec openspec-graph view
```

`view` выводит локальную ссылку на граф. Для обновления основного снимка после
изменения файлов перезапустите команду. Связи графа выводятся из спецификаций
и Repository Impact; они не доказывают фактические зависимости кода.

Подробнее: [Plugins](docs/user/plugins.md) и [подключение командных Store](docs/user/configuration.md#подключённые-store-роль-specs).

Независимое расширение (standalone Extension) из npm добавляется отдельно:

```bash
openspec-orch extension init <extension-id> --from <package@version>
openspec-orch extension connect <extension-id>
openspec-orch extension status <extension-id>
```

Версии внешних пакетов хранятся в `.openspec-orch/packages/package.json` и
`package-lock.json`; `openspec-orch.yaml` хранит только их стабильные ID.

## Документация

- [полная карта документации](docs/README.md);
- [установка, обновление и откат](docs/user/installation-and-updates.md);
- [создание проекта и подключение существующего Store](docs/user/getting-started.md);
- [конфигурация](docs/user/configuration.md) и [Project Template](docs/user/project-template.md);
- [бизнес-контекст проекта](docs/user/project-context.md) и [инициативы нескольких команд](docs/user/initiatives.md);
- [Plugins: эксплуатация, отключение и удаление](docs/user/plugins.md);
- [единый процесс работы над Jira Story](docs/user/story-delivery-process.md);
- [архитектура](docs/technical/architecture.md), [справочник CLI/MCP](docs/technical/reference.md)
  и [модель данных](docs/technical/data-model.md);
- [разработка Plugin](docs/technical/plugin-platform.md) и
  [разработка Orchestrator](docs/technical/development.md).

Термины Store, Code Repository, OpenSpec Change и типы процессных PR закреплены в
[глоссарии проекта](CONTEXT.md).

## Разработка Orchestrator

Для изменения этого репозитория достаточно Node.js и Git. Из чистой рабочей копии:

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git
cd multi-repo-specs
npm ci
npm run check:environment
npm run check
git diff --check
```

OpenSpec 1.11.0 устанавливается локально как dev dependency. Глобальный OpenSpec,
`npm link` и авторизация у провайдеров агентов для разработки не нужны. `.nvmrc` фиксирует
Node 22.16.0 — минимальную версию из CI. CLI работает без отдельной сборки.
`npm run check:all` дополнительно проверяет установку упакованных пакетов
в отдельное тестовое окружение и требует доступа к реестру npm.

Автоматические тесты с адаптерами не заменяют сквозную проверку работы реального агента.
В пилоте проверяйте рабочий сценарий отдельно для выбранного провайдера.

Агент начинает с [AGENTS.md](AGENTS.md); команды для одного теста, структура кода и
диагностика описаны в [руководстве разработчика](docs/technical/development.md).
Инструкции в `templates/` и `extensions/` поставляются в пользовательские проекты.
