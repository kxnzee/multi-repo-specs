# Project Template

Project Template — локальный каталог, который openspec-orch init накладывает на
результат штатного openspec init. Он устанавливает project-local инструкции,
контекст и расширения агента, но не добавляет команды в Core и не изменяет встроенные
OpenSpec skills и commands.

## Ответственность

| Слой | Владеет |
|---|---|
| OpenSpec | Schema, Specs, Changes, artifact lifecycle и официальный agent pack |
| Orchestrator Core | Безопасное применение Template, Store/repository routing и CLI |
| Project Template | Agent mapping, project context, rules, skills, commands и subagents |
| Plugins | Собственный lifecycle, CLI, MCP и добавляемые ими инструкции |

Template применяется только при init. После установки скопированные файлы
принадлежат проекту; Core не зависит от исходного каталога Template и не обновляет
его автоматически. Явно переданный Template полностью заменяет базовый — merge двух
Template отсутствует.

## Базовый состав

templates/base/ устанавливает:

- постоянный файл инструкций выбранного агента;
- openspec/config.yaml, openspec/graph.yaml, openspec/context/ и project-local schema
  base-v1 с первым artifact intake.md;
- command-опросник /openspec-base-intake, который собирает ответы в intake.md и
  выбирает маршрут Explore/Proposal/уточнение;
- command /openspec-base-context для initialize/audit/update, включая необязательную
  change/spec/domain-scoped актуализацию context и ADR после Archive;
- skills base-intent, openspec-base-meta-planning, openspec-base-apply-context,
  openspec-base-graph-maintenance и openspec-base-test-cases;
- один read-only subagent openspec-base-repository-evidence-scout.

Канонический смысл правил находится в самих установленных артефактах:

- источник требований и доступ к Code Repositories — в корневых инструкциях агента;
- правила Intake/Proposal/Specs/Design/Tasks — в openspec/config.yaml;
- Graph lifecycle и relation semantics — в документации OpenSpec Graph Plugin;
- один repository evidence request — в профиле scout;
- пользовательский процесс — в [командном процессе](team-flow.md).

Этот документ не повторяет их исполняемые контракты.

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
содержательного Planning Route. Команда не запускает Explore или Proposal сама.

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

OpenSpec Graph строит типизированную Store-level модель из реестра, Specs и Changes.
openspec/graph.yaml содержит только подтверждённые explicit relations с
Store-relative path:line evidence. CodeGraph отдельно индексирует реализацию внутри
уже выбранного Code Repository. Template не связывает их внутренние форматы.

## Ограничения

- Template не является npm package и не имеет version/update lifecycle.
- Нет interpolation, conditions, delete rules, hooks и автоматического merge.
- Отличающийся существующий target-файл блокирует init; Core не перезаписывает его.
- Запрещена запись в .git/, .openspec-store/, openspec-orch.yaml и за пределы target.
- Symlink, специальные файлы, небезопасные paths и file/directory collisions
  отклоняются.
- Неизвестные поля template.yaml отклоняются.
- Совместимость собственной schema, commands и provider extensions отвечает автор
  Template.

Локальное техническое устройство Code Repository, его test/build commands и
repository-specific agent instructions не переносятся в центральный Store.
