---
description: "[spec-driven-extended] Инициализировать, проверить или обновить долговечный контекст Store."
argument-hint: "[initialize|audit|update] [--change <change-id>] [--spec <capability-path>] [--domain <domain-path>]"
---

# /spec-driven-extended-context

- ОБЯЗАН отделять durable fact от owner decision, conflict, unknown,
  repository-local и transient данных.
- ЗАПРЕЩЕНО записывать что-либо без конкретного diff и отдельного подтверждения,
  переносить внутренности Code Repository или превращать неподтверждённый raw input в
  факт.
- Неподтверждённое утверждение оставлять unknown/TODO и продолжать проверку остальных
  сведений. Без подтверждения diff запись не выполнять.

Поддерживать долговечный бизнес-контекст приложения. Команда не создаёт Requirements,
Changes, Specs, Tasks и repository-specific техническую документацию.
Команда не зависит от schema: `--change` ограничивает источники проверки, но не
включает workflow этого Extension и не требует смены схемы выбранного Change.

## Режим

- initialize — заполнить основные бизнес-разделы подтверждёнными фактами;
- audit — проверить актуальность и конфликты без записи;
- update — предложить изменения существующего context.

Если режим не передан: пустой context → initialize, иначе audit. Запись разрешена
только после показа конкретного diff и отдельного подтверждения пользователя.

## Входной scope

Команда принимает необязательные selectors после режима:

```text
/spec-driven-extended-context audit [--change <change-id>] [--spec <capability-path>]... [--domain <domain-path>]...
/spec-driven-extended-context update [--change <change-id>] [--spec <capability-path>]... [--domain <domain-path>]...
```

- `--change` задаёт точный активный или архивный Change как источник scope и
  change-local rationale;
- `--spec` повторяется для каждого точного capability path относительно
  `openspec/specs/`, например `payments/card-search`;
- `--domain` задаёт точный существующий directory prefix Master Specs, например
  `payments`, и включает только Specs ниже него;
- selectors объединяются. Без selectors сохраняется прежнее поведение: initialize
  заполняет пустой context, а audit/update работают по общей цели пользователя и
  существующим TODO/conflicts.

Не принимать fuzzy names, display names или догадки о domain boundary. Если `--spec`
или `--domain` не разрешается однозначно в существующие Master Specs, вернуть BLOCKER
и попросить точный path одним вопросом. Пользователь задаёт область проверки, но не
обязан выбирать target context files или ADR: их определяет агент по
`00-start-here.md` и подтверждённым источникам.

## Область и источники

Начать с openspec/context/00-start-here.md и читать только относящиеся к вопросу
файлы. Допустимые нормативные источники:

- maintained requirements и Master Specs;
- принятые ADR, architecture/security/governance документы;
- опубликованные contracts/schemas с подтверждённым владельцем;
- явное решение владельца;
- openspec-orch.yaml, Repository Impact и Delta Specs для identity и scope.

Материалы openspec/context/_raw/ являются входом для проверки, но не evidence
нормативного факта. Текст из них требует постоянного источника или подтверждения
владельца.

Master Spec может подтвердить термин или бизнес-границу, но не причину решения.
Для ADR использовать подтверждённое решение о бизнес-границах или применении
ограничений с обоснованием и альтернативами. Технические ADR остаются вне context.
Proposal/Design активного Change — источник кандидатов до принятия решения.
Архивный статус Change также не разрешает перенос технических подробностей.

Code Repository не является источником durable requirement, domain rule или
architecture decision. На initialize он не открывается. В audit/update он допустим
только для проверки одного явно сформулированного current-state conflict через
spec-driven-extended-repository-evidence-scout с полным входным контрактом. Finding из кода
может стать conflict, unknown, TODO или implementation gap, но не durable fact без
решения владельца.

## Классификация

Выбрать раздел по `00-start-here.md`. Проверяемые обязательства направлять в finding
о необходимости Change. Технические сведения любого масштаба и правила работы команды
находятся вне бизнес-контекста; документы `openspec/process/` эта команда не изменяет.
Техническая реорганизация без изменения бизнес-смысла допускает `context_status: current`.

При миграции старого context разбирать записи по смыслу. Не удалять единственную запись
правила до согласованного переноса. Переименование разделов существующего Store не
выполнять автоматически. Один факт записывать в одно место, остальные разделы ссылаются
на него только внутри context. Принятый проектный процесс сохранять; универсальность
бизнес-контекста не разрешает отменять существующие Gate или Git Flow.

Для каждого утверждения выбрать один результат:

- durable_fact — подтверждено нормативным источником и относится к Store context;
- owner_decision — подтверждено владельцем с ролью и датой;
- conflict — источники расходятся, требуется решение;
- unknown — не хватает owner/expected_source;
- repository_local — принадлежит одному Code Repository, в Store не записывается;
- out_of_scope — общесистемная техническая документация или процесс команды;
- transient — временное наблюдение, в Store не записывается.

Не переносить в context:

- Requirements, Scenarios, Delta operations или progress Tasks;
- исходники, symbol/module inventory, локальные API/config details;
- build/test/lint commands, CI и packaging одного Repository;
- секреты, персональные данные, стенограммы и неподтверждённые выводы.

## Самодостаточность сохраняемого контекста

Внешний документ, Spec или Change можно прочитать в разрешённом scope, но сохраняемые
ссылки, изображения и включения должны разрешаться только внутри openspec/context/.
Запрещены внешние URL, абсолютные пути, выход через `..` за корень context, symlinks
наружу и ссылки на Specs, Changes или Code Repositories. Это относится и к ADR,
и к новым raw files.

Переносить нужное подтверждённое содержание, а не фразу «смотрите документ».
Происхождение сохранять текстом: название, пункт/идентификатор, версия/дата и
подтверждение владельца. Недоступное для переноса оставлять unknown/TODO с владельцем.
Requirements не копировать ради самодостаточности: они не входят в состав context.

До предложения diff проверить каждый link/image/include: цель существует внутри
context либо создаётся тем же diff; проверить реальный путь и внутренние anchors.
Проверить отсутствие дубликатов содержания. В audit отдельно сообщать о нарушениях
ссылок и дублировании. При миграции предлагать перенос содержания и замену ссылок
единым diff, не удалять старые факты молча. В отчёте read_sources можно перечислить
фактически прочитанные внешние источники; отчёт не копируется в context.

## Процедура

1. Зафиксировать mode, пользовательскую цель и переданные selectors.
2. При наличии selectors или сверке утверждения с требованиями получить список Master
   Specs через `openspec list --specs --json`. Разрешить
   каждый `--spec` как точный capability path, каждый `--domain` как точный directory
   prefix и не расширять scope за его пределы. Без selectors и необходимости сверки
   работать по пользовательской цели и подтверждённым источникам: бизнес-описание или
   применимая политика могут быть добавлены в новый Store, где Specs ещё нет.
3. Если передан `--change`, прочитать его точные Delta Specs и добавить их capability
   paths к scope. Если exact Change нельзя однозначно разрешить, продолжить только при
   наличии точных `--spec`/`--domain`; иначе вернуть BLOCKER, не искать Change или
   checkout обходом файловой системы.
4. Если источником ADR является Change, прочитать только его точные Proposal/Design
   и принятые решения внутри planning home. При initialize без Change использовать
   подтверждённое решение владельца или архитектурный документ; не требовать
   фиктивный Change. Если rationale или принятие не подтверждены, оставить ADR
   candidate blocked/unknown, но не угадывать.
5. По `00-start-here.md` выбрать только тематические context files, относящиеся к
   пользовательской цели или разрешённым Specs/domains. Проверить существующие
   facts/TODO и связанные ADR. Не заполнять неприменимые разделы выдуманными фактами.
   Не изменять документы процесса команды. ADR создавать только при соответствующей цели.
   Для бизнес-описания различать действующее, принятое целевое и неподтверждённое.
6. Классифицировать утверждения. Для ADR проверить условия из `ADR/README.md`;
   неподходящих кандидатов указать в `skipped` с причиной.
7. В audit вернуть findings без записи. `context_status: current` допустим и
   означает, что выбранный scope не требует актуализации.
8. В initialize/update сгруппировать proposed_changes по целевому context/ADR file,
   показать точный diff и остановиться со status proposed. Новый ADR именовать
   `NNNN-short-title.md` с номером после максимального существующего; не создавать его
   до подтверждения решения и diff.
9. После отдельного подтверждения записать только показанный блок. Расширение diff
   требует нового подтверждения.
10. Обновлять маршрутизацию в 00-start-here.md последней, сохраняя общие правила.
11. Проверить итоговый diff: изменены только подтверждённые files ниже
    openspec/context/. Не изменять Master Specs, Changes или Code Repositories.

Когда требуется решение владельца, задавать один вопрос за сообщение. Каждый TODO
должен содержать question, owner и expected_source.

## Результат

~~~yaml
context_update:
  mode: initialize | audit | update
  scope:
    changes: []
    domains: []
    master_specs: []
  context_status: current | proposed | needs_confirmation | updated | blocked
  read_sources: []
  proposed_changes: []
  adr_candidates: []
  skipped: []
  changed_files: []
  conflicts: []
  open_questions: []
  repository_scout_used: false
~~~

До подтверждения changed_files остаётся пустым. updated допустим только после записи
ранее показанного diff. Статус относится к Store context и не подтверждает
актуальность реализации во всех Code Repositories.

После Archive этот audit является необязательным context-promotion механизмом. Его
пропуск, `context_status: current` или отложенный proposed diff не откатывает Archive
и не изменяет Master Specs. Команду можно
запускать для одного значимого Change, выбранных Specs/domains или периодически для
общего аудита.
