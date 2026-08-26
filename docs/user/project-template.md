# Project Template

Project Template — локальный каталог, который openspec-orch init накладывает на
результат штатного openspec init. Он устанавливает project-local инструкции,
контекст и расширения агента, но не добавляет команды в Core и не изменяет встроенные
OpenSpec skills и commands.

## Ответственность

| Слой | Владеет |
|---|---|
| OpenSpec | Schema, Specs, Changes, artifact lifecycle и официальный agent pack |
| Orchestrator Core | Безопасное применение Template, разрешение required Plugin ID, Store/repository routing и CLI |
| Base Template | Agent mapping, required Plugin IDs, project context, rules, skills, commands и subagents |
| Plugin Template | Plugin-specific файлы Store, устанавливаемые только через `plugin init` |
| Plugins | Собственный lifecycle, CLI, MCP и добавляемые ими инструкции |

Base Template применяется при `openspec-orch init`. После установки скопированные файлы
принадлежат проекту; Core не зависит от исходного каталога Template и не обновляет
его автоматически. Повторный `init` проверяет required Plugin set. Явно переданный
Project Template полностью заменяет базовый — merge двух Project Template отсутствует.

## Базовый состав

templates/base/ устанавливает:

- постоянный файл инструкций выбранного агента;
- openspec/config.yaml, openspec/context/ и project-local schema
  base-v1 с первым artifact intake.md;
- command-опросник /openspec-base-intake, который собирает ответы в intake.md и
  выбирает маршрут Explore/Proposal/уточнение;
- command /openspec-base-context для initialize/audit/update, включая необязательную
  change/spec/domain-scoped актуализацию context и ADR после Archive;
- skills base-intent, openspec-base-meta-planning, openspec-base-apply-context и
  openspec-base-test-cases; Apply Context является единым диспетчером и не содержит
  правил Cycle/Receipts/Snapshot;
- один read-only subagent openspec-base-repository-evidence-scout.

Текущий Base Template объявляет `openspec-graph` в `requires.plugins`. Успешный
`openspec-orch init` разрешает его через Plugin Catalog, устанавливает обычным Plugin
lifecycle и сохраняет в `openspec-orch.yaml` точную package identity с
`required: true`. Поэтому Graph является обязательной частью именно этого Project
Template, но его команды и assets не становятся частью Core или Base Template.

Канонический смысл правил находится в самих установленных артефактах:

- источник требований и доступ к Code Repositories — в корневых инструкциях агента;
- правила Intake/Proposal/Specs/Design/Tasks — в openspec/config.yaml;
- Graph lifecycle и relation semantics — в документации OpenSpec Graph Plugin;
- один repository evidence request — в профиле scout;
- пользовательский процесс — в [командном процессе](team-flow.md).

Этот документ не повторяет их исполняемые контракты.

`openspec-graph-maintenance` и начальный `openspec/graph.yaml` не входят в Base
Template. Они находятся в собственном Template OpenSpec Graph Plugin и появляются
только при его установке. Обновление Base Template не меняет Plugin assets. Custom
Project Template без `openspec-graph` не получает их и должен определять процесс без
Graph-команд.

Аналогично, `change-tracking-apply-context` принадлежит Template Change Tracking
Plugin и появляется только после `plugin init --plugin change-tracking`. Base skill
`openspec-base-apply-context` остаётся единым пользовательским entrypoint: без Plugin
он готовит Standard Apply, а при подключённом Change Tracking передаёт ему проверки
Cycle и затем продолжает общий Graph preflight. Поэтому отключение Plugin не лишает
Template Standard Apply и не оставляет в Base копию plugin-specific правил.

## Plugin Template

Plugin может положить в npm package каталог `template/` с обычным `template.yaml`
и каноническими файлами поверх того же безопасного copy engine. В Plugin descriptor
достаточно `agents.<id>.copy`; поля Base mapping (`openspec_adapter`, directories,
instructions) не повторяются. Если Plugin не объявляет собственную Agent contribution,
Core автоматически применяет mapping зарегистрированного Agent при `plugin init`.
В `index.js` не нужны copy rules.

Отличающийся существующий Store-файл блокирует установку, одинаковый пропускается.
При `plugin remove` Core удаляет Plugin declaration и runtime, но не удаляет файлы
из Store. CLI перечисляет их относительные пути, чтобы пользователь при необходимости
удалил их вручную.

Для нестандартного merge автор Plugin может явно использовать Agent API с
`install/remove` либо декларативным `copy: [{from, to}]`. Явная contribution заменяет
автоматическое применение `plugin/template/`.

## Project commands

Команды запускаются в агенте из корня Store и не являются командами
`openspec-orch`:

```text
/openspec-base-intake <change-id>
/openspec-base-context initialize
/openspec-base-context audit [--change <change-id>] [--spec <capability-path>]... [--domain <domain-path>]...
/openspec-base-context update [--change <change-id>] [--spec <capability-path>]... [--domain <domain-path>]...
```

Примеры адресного read-only аудита:

```text
/openspec-base-context audit --change <change-id>
/openspec-base-context audit --spec <capability-path>
/openspec-base-context audit --domain <domain-path>
```

`/openspec-base-intake` задаёт по одному адаптивному вопросу, учитывает уже
полученные ответы и записывает единственный `intake.md` только после появления
содержательного Planning Route. Перед новым Change должен существовать согласованный
Intent: принятый Daily Intent Brief либо доступное содержание Jira Story/другого
источника с изменением, Why Now, ожидаемым улучшением, критериями успеха и
ограничениями. При наличии такого источника `base-intent` повторно не запускается;
Intake переносит подтверждённые выводы и спрашивает только пробелы. Команда не
запускает Explore или Proposal сама.

`/openspec-base-context audit` является read-only: пользователь задаёт scope, агент
разрешает точные Master Specs и сам выбирает связанные context-файлы и ADR candidates.
`update` сначала показывает конкретный diff и записывает только после отдельного
подтверждения. Master Spec может подтвердить durable context, но ADR требует
принятого источника WHY и реальных альтернатив. Post-Archive audit необязателен и не
блокирует Archive.

Code Repository используется агентом только для адресной сверки заранее
сформулированного current-state утверждения. Найденные paths, symbols, модули,
локальная конфигурация и другое внутреннее устройство не копируются в Store context
или Change artifacts. В центральном Store остаются наблюдаемое поведение, доменные
правила, принятые системные решения, repository-id и публичные контракты.

Repository Impact содержит только репозитории, где Change требует изменения кода,
тестов, конфигурации или документации. Полный registry и Graph review-контур в него не
копируются; для неизменяемых репозиториев строки `no-change` не создаются.

## Создание собственного Template

Скопируйте базовый каталог либо начните с минимального:

~~~text
team-template/
├── template.yaml
└── AGENT.md
~~~

~~~yaml
requires:
  plugins:
    - openspec-graph

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
~~~

Ключ team-agent является значением --agent. openspec_adapter передаётся штатному
openspec init --tools. Если generated_directory и target_directory различаются, Core
сначала переносит официальный pack, затем выполняет copy сверху вниз. Файлы Template
дополняют официальный pack, но не удаляют его commands и skills.

Применение:

~~~bash
openspec-orch init /absolute/path/to/store \
  --store payments-specs \
  --agent <agent-id> \
  --template /absolute/path/to/team-template
~~~

Поддерживаемые mapping базового Template перечислены в
[справочнике агентов](supported-agents.md).

## Поля agent mapping

| Поле | Назначение |
|---|---|
| openspec_adapter | Adapter штатного openspec init |
| generated_directory | Каталог, созданный OpenSpec |
| target_directory | Итоговый provider-specific каталог |
| commands_directory | Каталог официальных agent commands |
| instructions_file | Корневой файл постоянных инструкций |
| handoffs | Необязательные именованные paths пользовательского Template |
| copy | Упорядоченные операции from → to |

`requires.plugins` — уникальный список Plugin ID из distribution catalog. Если ID
не найден или установка не завершилась, `openspec-orch init` возвращает ошибку и не
объявляет Project Template полностью готовым. Повторный `init` повторяет reconciliation.
Plugin, удалённый из списка новой версии Template, остаётся установленным, но теряет
`required: true` и после отключения bindings может быть удалён вручную.

Содержимое skills и subagents хранится один раз в каноническом каталоге. Отдельный
adapter допустим только для provider frontmatter; его смысловое тело должно совпадать
с каноническим и проверяется distribution tests.

## Точки расширения

Пользовательский Template может:

- заменить openspec/config.yaml или добавить project-local schema;
- добавить context files, commands, skills и subagents;
- выбрать собственный namespace;
- добавить provider adapter и copy operations.

Для project-local схемы выбранный workflow определяется полями `schemaName` в выводе
OpenSpec и `schema` в `.openspec.yaml` Change. В OpenSpec 1.10.0 диагностическое поле
`planningHome.defaultSchema` для repo-local planning home всегда сообщает встроенный
fallback `spec-driven` и не отражает `schema: base-v1` из `openspec/config.yaml`; его
нельзя использовать для проверки фактически выбранной схемы.

OpenSpec Graph Plugin строит типизированную Store-level модель из реестра, Specs и
Changes и поставляет начальный `openspec/graph.yaml` для подтверждённых explicit relations.
CodeGraph отдельно индексирует реализацию внутри уже выбранного Code Repository. Template
не связывает их внутренние форматы.

## Ограничения

- Template не является npm package и не имеет version/update lifecycle.
- Нет interpolation, conditions, delete rules и автоматического merge двух Project Template.
- Отличающийся существующий target-файл блокирует init; Core не перезаписывает его.
- Запрещена запись в .git/, .openspec-store/, openspec-orch.yaml и за пределы target.
- Symlink, специальные файлы, небезопасные paths и file/directory collisions
  отклоняются.
- Неизвестные поля template.yaml отклоняются.
- Совместимость собственной schema, commands и provider extensions отвечает автор
  Template.

Локальное техническое устройство Code Repository, его test/build commands и
repository-specific agent instructions не переносятся в центральный Store.
