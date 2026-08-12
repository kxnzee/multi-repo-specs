---
description: "Реализовать назначенные Work Packages в одном Code Repository"
---

Эта standalone-инструкция запускается в новой сессии из Code Repository, где файл инструкций выбранного агента может отсутствовать. Поэтому языковой контракт здесь является обязательным локальным fallback.

Первое сообщение всегда начни на русском языке. Всегда общайся с пользователем на русском языке. На русском формулируй вопросы, пояснения, промежуточные итоги, описания diff и финальный отчёт. Не переходи на английский из-за англоязычных исходников. Не переводи только код, команды, пути, идентификаторы, имена полей и обязательные машинные значения.

Эта инструкция выполняет шаг 06 после успешного `sdd load` шага 05. Она реализует назначенную часть принятого OpenSpec Change только в текущем Code Repository. Она не является slash-командой и не требует новой CLI-команды.

## Вход

Новая агентская сессия запускается из корня целевого Code Repository готовым первым сообщением `next_action`. Сообщение содержит точный путь к этой инструкции и параметры:

```text
--store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>...
```

Требуй ровно по одному `--store`, `--repo`, `--change` и `--baseline`, а также один или несколько уникальных `--work-package`. Используй тот же набор значений, который был передан в успешный `sdd load`. Не вычисляй Store, repository, Baseline или Work Packages автоматически и не подменяй их значениями из истории диалога, Git-ветки или свободного текста.

Из корня Code Repository определи workspace только по стандартному пути `<workspace>/src/<repository-id>` и открой точный runtime:

```text
<workspace>/.sdd/runtime/<store-id>/<change-id>/<repository-id>/context.json
```

Не ищи `context.json` по glob, не запускай `sdd load` автоматически и не требуй дополнительную команду подготовки.

## 1. Проверь runtime и границы

До любого изменения файлов прекрати выполнение, если выполняется хотя бы одно условие:

- обязательный одиночный параметр отсутствует или повторён;
- `--work-package` отсутствует, содержит пустой либо повторяющийся ID;
- runtime отсутствует, не является обычным файлом, имеет неизвестную структуру или не содержит `version: 1` и `step_status: implementation_ready`;
- переданные Store, repository, Change, Baseline или полный набор Work Packages не совпадают с runtime;
- cwd не равен `code_root` после разрешения реального пути;
- текущая ветка не равна `implementation_branch`;
- текущий HEAD не является потомком `code_base_revision`;
- `allowed_edit_roots` не содержит ровно один `code_root`;
- `immutable_roots` не содержит ровно один `spec_root`;
- `spec_root` не является обычным Git worktree, его HEAD не равен `spec_baseline` либо рабочее дерево изменено.

Несовпадение блокирует запись. Не исправляй runtime, ветку, параметры, dirty worktree или Baseline автоматически. Не выполняй stash, reset, rebase или checkout как способ пройти проверку.

## 2. Подтверди Change штатным OpenSpec API

Из `spec_root` выполни:

```bash
openspec validate <change-id> --type change --strict --no-interactive --json
openspec instructions apply --change <change-id> --json
```

Проверь, что обе команды разрешили тот же `spec_root` и тот же Change, строгая валидация успешна, а Apply имеет состояние `ready`. Каждый переданный Work Package должен существовать как точный `tasks[].id` официального ответа и оставаться невыполненным.

Сразу отфильтруй официальный `tasks[]` по полному набору ID из runtime и зафиксируй для текущей сессии точные пары `id → description`. Для каждого ID должна существовать ровно одна отдельная строка. Это единственное допустимое сопоставление Work Packages на шаге 06.

Каждый `task.id` означает один checkbox OpenSpec. Число в начале `description`, например `2.1`, является частью текста Task, а не `task.id`; заголовок раздела `tasks.md` также не является Work Package ID. Не объединяй несколько ID в один пакет, не перенумеровывай их по разделам и не приписывай ID описание соседней Task.

Используй только перечисленные в runtime Work Package ID. Не копируй Tasks в runtime, не извлекай ID из `description` и не выводи назначение репозиторию из свободного текста.

## 3. Собери минимальный контекст

Из принятого Change прочитай только необходимое:

- Proposal — для границ изменения;
- применимые Specs и Scenarios — для ожидаемого поведения;
- относящиеся к текущему репозиторию части `design.md` — для контракта, совместимости и rollout;
- выбранные `tasks[].id` — для результата и проверок.

Технический контекст сначала ищи в действующем файле инструкций агента текущего Code Repository. Его путь определён `agent.instructions_file` в `sdd.yaml`. Не сканируй `commands/`, `skills/` или `agents/` в поиске другого контекста. Если файла нет или сведений недостаточно, адресно прочитай связанные код и тесты. Не загружай весь крупный репозиторий или другие Code Repositories автоматически.

Для простой работы используй краткий план текущей сессии. Локальный technical design, implementation plan или checklist допустим только если действительно нужен по правилам Code Repository. Он необязателен, не создаёт SDD-гейт и не становится источником требований.

## 4. Реализуй Work Packages

Изменяй только текущий Code Repository внутри единственного `allowed_edit_root`. Реализуй только назначенные Work Packages и необходимые для них локальные тесты.

Не изменяй:

- центральный Store, `spec_root`, `tasks.md`, Specs или planning-артефакты;
- другие Code Repositories;
- Work Packages, назначенные другим репозиториям;
- файл инструкций агента, если его обновление прямо не входит в назначенную работу;
- встроенные skills `openspec-*` и команды `opsx-*` provider-specific agent pack.

Не расширяй scope найденными сопутствующими проблемами. Перечисли их отдельно в отчёте или PR.

Если точный Work Package нельзя завершить без записи в другой Code Repository, Composite Verification или недоступного внешнего окружения, не подменяй его соседней Task и не объявляй выполненным. Оставь этот ID со статусом `incomplete` либо `blocked` и укажи точную причину.

Не заменяй проверку указанного в Work Package другого репозитория или точной ревизии локальной имитацией поведения потребителя. Если эта ревизия недоступна в разрешённых границах чтения, оставь Work Package незавершённым.

При повторном запуске с теми же параметрами сначала прочитай текущий diff и продолжи только незавершённую работу. Новый progress-state не создавай. Повторный `sdd load` не нужен, пока runtime, Baseline и назначение не изменились.

## 5. Выполни проверки репозитория

Определи команды из файла инструкций агента, package scripts и CI текущего Code Repository. Используй только уже существующие в репозитории инструменты и конфигурацию проверок. Не добавляй package manager, зависимости, test runner, build-конфигурацию или отдельные скомпилированные файлы только ради запуска проверки. Если штатной инфраструктуры нет, укажи проверку как `Not run` с причиной.

Выполни применимые:

- lint, format и static checks;
- unit и компонентные тесты;
- contract-тесты;
- build или compile;
- проверку diff на случайные и несвязанные изменения.

Покажи пользователю итоговый diff и `git status --short`. Для каждой проверки зафиксируй фактическую команду и результат. Значение `passed` допустимо только для действительно выполненной команды с успешным exit code. Упавшая обязательная проверка блокирует готовность реализации. Невыполненную проверку укажи как `Not run` с причиной; отсутствие инструмента, конфигурации или test runner никогда не является `passed`.

Если описание Work Package прямо требует тест, контрактную проверку или другое проверяемое подтверждение, `Not run` означает, что этот ID имеет статус `incomplete` либо `blocked`. Созданный, но не запущенный тест не завершает такой Work Package.

Для Work Package о сохранении существующего поведения сначала сравни результат с `code_base_revision`; не выводи ожидаемое прежнее поведение из уже изменённого кода. Без такого сравнения и требуемой проверки этот ID не имеет статус `completed`.

После работы снова проверь, что `spec_root` чист и остаётся на том же `spec_baseline`. Любое изменение immutable Store блокирует завершение и требует повторного `sdd load` после устранения причины.

## 6. Подготовь передачу в implementation PR

Не создавай commit, не выполняй push или rebase, не открывай и не изменяй PR или tracker без отдельного явного поручения пользователя. Если такое поручение получено, используй обычный Git-процесс Code Repository:

1. после первого связного commit опубликуй ветку и открой Draft PR;
2. свяжи PR с ticket, OpenSpec Change, Planning PR, implementation subtask и известными implementation PR других репозиториев;
3. исправляй review comments в той же ветке и PR;
4. перед переводом PR в ready синхронизируй ветку принятым в проекте rebase и повтори проверки;
5. после успешного code review зафиксируй в subtask точную полную SHA HEAD готового PR только по явному поручению пользователя.

После любого следующего commit прежняя `code_revision` устаревает и должна быть заменена после повторных проверок. Обычный `git push --force` запрещён; после разрешённого rebase собственной опубликованной ветки допустим только `git push --force-with-lease`.

Implementation PR на шаге 06 не сливай. Не отмечай checkbox в центральном `tasks.md`, не выполняй Composite Verification, rollout или Archive и не предлагай `/opsx-archive`.

## Итоговый отчёт

Заверши ответ кратким структурированным итогом:

```text
step_status: implementation_ready_for_pr | implementation_in_progress | blocked
store_id: <store-id>
change_id: <change-id>
spec_baseline: <full-store-sha>
repository_id: <repository-id>
work_packages: <id, ...>
work_package_results:
  - id: <exact task.id>
    description: <exact official description>
    implementation: <summary | none>
    verification: <command and evidence | Not run with reason>
    status: completed | incomplete | blocked
implementation_branch: <branch>
checks: <command and passed | command and failed | Not run with reason>
store_unchanged: true | false
next_step: complete_checks | implementation_pr | 07 | blocked
```

Укажи `step_status: implementation_ready_for_pr` только если каждый переданный ID имеет статус `completed`, все обязательные проверки действительно выполнены и успешны, а Store остался неизменным. Незавершённый Work Package или обязательная проверка `Not run` требует `implementation_in_progress` либо `blocked`.

Используй `next_step: complete_checks`, если реализация ожидает обязательные проверки, и `next_step: implementation_pr` — только для `implementation_ready_for_pr`. Используй `next_step: 07` только если implementation PR уже прошёл code review, его текущая полная `code_revision` зафиксирована в subtask и все implementation PR Change готовы к Composite Verification. Никогда не указывай Archive следующим шагом.
