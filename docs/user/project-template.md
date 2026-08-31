# Project Template

Project Template — copy-only каталог, который `openspec-orch init` один раз безопасно
накладывает на результат штатного OpenSpec init. Он не выбирает Agent или Plugin, но
может объявить обязательные совместимые Extensions через `requires.extensions`.

## Bundled Project Template

В поставке один bundled Template:

| ID | Required Extensions | Schemas | Назначение |
|---|---|---|---|
| `default` | `openspec-base`, `superpowers` | `spec-driven-extended`, `superspec-multirepo` | Общий project context и два независимых процесса Change |

Без `--template` используется `default`. Он копирует:

- общий `openspec/config.yaml`, где расширенная штатная schema
  `spec-driven-extended` указана по умолчанию;
- обе project-local schema в `openspec/schemas/`;
- общий project context и ADR;
- `.gitignore` из явного asset mapping.

Обе схемы установлены в одном Store, однако конкретный Change всегда принадлежит
ровно одной из них. Это штатный механизм OpenSpec: schema записывается в
`openspec/changes/<change-id>/.openspec.yaml` при создании Change.

```bash
# Короткий процесс; --schema можно опустить, поскольку spec-driven-extended — default
openspec new change update-copy --schema spec-driven-extended

# Полный Superspec-процесс
openspec new change redesign-checkout --schema superspec-multirepo
```

После создания не меняйте schema Change для переключения процесса: DAG и уже
созданные artifacts могут стать несовместимыми. Создайте новый Change с нужной
schema и перенесите только подтверждённый смысл вручную.

## Два процесса в одном Store

`spec-driven-extended`:

```text
intake → proposal → specs + design → tasks → verify
```

Apply у Base является OpenSpec operation, отслеживает `tasks.md` и не создаёт
`apply.md`. `verify.md` — отдельный artifact gate схемы. Его инструкция вызывает
стандартный `openspec-verify-change`; наличие готового к заполнению artifact ещё не
доказывает существование кандидата и не разрешает `PASS`.

Самостоятельный `/opsx:verify` возвращает стандартный upstream-отчёт, но не сохраняет
schema artifact. Для фиксируемого gate перейдите к artifact `verify` по DAG Change и
заполните его по выданной OpenSpec инструкции.

`superspec-multirepo`:

```text
brainstorm → proposal + optional design → specs → tasks → plan
→ apply → verify → finalize
```

Superspec сохраняет полный skill-driven цикл Superpowers и receipts `apply.md`,
`verify.md`, `finalize.md`.

Обе схемы используют дословно один `Candidate Verification Contract v1`: проверяется
точная identity текущего кандидата, свежие автоматические проверки, принятые
Scenarios, блокирующие дефекты и внешнее подтверждение ответственного для этой версии
и deployment. Candidate Acceptance имеет только `PASS` или `FAIL`, устаревает после
нового commit/build/deployment и сам по себе не разрешает Release или Archive.

Различается только процессная часть:

- в Base `Process Compliance` имеет значение `NOT_APPLICABLE`;
- в Superspec отдельно оценивается соблюдение его execution-процесса как `PASS`,
  `PASS_WITH_WARNINGS` или `FAIL`.

Таким образом, уровень приёмки результата одинаков, а дополнительная проверка
Superspec не ослабляет и не расширяет Candidate Acceptance.

OpenSpec машинно вычисляет доступность artifacts по `requires` выбранной schema.
Условия Release и Archive передаются штатной инструкцией
`operations.archive.guidance` из `openspec/config.yaml`: это policy input для Agent
workflow, но не пользовательский исполняемый Archive hook внутри OpenSpec 1.11.
Человеческие Gates и фактический Release остаются внешними подтверждениями.

## Extensions и Plugins

`default` требует обе Extensions. `openspec-base` поставляет Base-команды, skills,
instructions и repository evidence subagent; `superpowers` — локальный MIT-снимок
общих execution skills. Required Extensions добавляются автоматически и недоступны
для снятия; `--no-extensions` с `default` отклоняется.

Agent, дополнительные Extensions и Plugins выбираются отдельно. Change Tracking,
OpenSpec Graph и CodeGraph не выбираются Template и подключаются только явным Plugin
lifecycle. Общий MCP gateway также не входит в Project composition: его устанавливают
отдельно через `openspec-orch agent setup`.

## Работа с repository evidence subagent

Для точечной проверки текущего кода `openspec-base` вызывает отдельного субагента
только для чтения. Он не планирует изменение и отвечает на один вопрос по одному
репозиторию.

- Один вопрос — один новый субагент. Пять вопросов означают пять независимых
  субагентов; их контекст не переиспользуется.
- Технические подтверждения остаются в evidence, а в Change попадает только итоговый
  вывод без внутренних деталей кода.
- Проверка кода допустима на Design, Tasks и Apply либо для подтверждения конфликта с
  текущим состоянием. На Intent, Intake, Proposal и Specs она не используется.

## Границы владения

| Владелец | Содержимое |
|---|---|
| OpenSpec | Официальный agent pack, выбор schema для Change, artifact lifecycle и operations |
| Core | Безопасное одноразовое копирование объявленных Template assets |
| Project Template | Context, project-local schemas/config и дополнительные assets |
| Extension | Instructions, commands, skills, subagents, hooks и простые MCP |
| Plugin | Runtime, repository lifecycle и Plugin-contributed Extension |

Встроенные `openspec-*` skills и `opsx-*` commands выбранного provider нельзя
переписывать Project Template. Project-local правила используют свой namespace.

## Жизненный цикл и миграция

Template применяется только во время `init`. Скопированные файлы принадлежат Store и
автоматически не обновляются. Повторный `init` не перезаписывает отличающийся
target-файл и не управляет Plugins.

Bundled ID теперь `default`; прежние `base` и `superspec` не являются aliases.
Существующий Store не мигрирует автоматически: обе schemas, общий config/context и
обе Extension declarations нужно перенести обычным проверяемым PR самого Store.

Строка lowercase kebab-case трактуется как bundled ID и при отсутствии в каталоге
отклоняется. Относительный локальный путь указывайте с `./`, например
`--template ./team-template`. Custom Template целиком заменяет `default`; merge
нескольких Templates не реализован.

## Минимальный custom Template

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
  --extension openspec-base \
  --template /absolute/path/to/team-template
```

Identity custom Template берётся из `template.yaml`; source path после применения не
сохраняется. Agent definition выбирается отдельно из distribution-owned каталога.

## Безопасность применения

Core запрещает:

- выход target path за корень Store;
- запись в `.git/`, `.openspec-store/` и `openspec-orch.yaml`;
- symlink и специальные файлы;
- file/directory collision;
- неизвестные поля `template.yaml`;
- перезапись существующего отличающегося файла.

Interpolation, conditions, delete rules и автоматическое удаление старых assets не
реализованы.

## Plugin-owned Extension

Plugin может вернуть один или несколько data-only Extension с package-relative root и
Store/Repository target. Core передаёт их тому же Agent Adapter, который обслуживает
standalone Extensions. Автоматического поиска или применения `template/` внутри
Plugin Package нет.
