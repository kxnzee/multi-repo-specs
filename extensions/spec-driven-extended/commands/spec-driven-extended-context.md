---
description: Инициализировать, проверить или обновить подтверждённый долговечный project context в openspec/context/.
---

# /spec-driven-extended-context

- ОБЯЗАН отделять durable fact от owner decision, conflict, unknown,
  repository-local и transient данных.
- ЗАПРЕЩЕНО записывать что-либо без конкретного diff и отдельного подтверждения,
  переносить внутренности Code Repository или превращать неподтверждённый raw input в
  факт.
- Нет нормативного source, owner decision или подтверждения записи — это BLOCKER.
  НЕМЕДЛЕННО ОСТАНОВИСЬ; оставь unknown/TODO и не угадывай.

Поддерживать только долговечные Store-level знания. Команда не создаёт Requirements,
Changes, Specs, Tasks и repository-specific техническую документацию.

## Режим

- initialize — заполнить пустые placeholders подтверждёнными фактами;
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

Master Spec может подтвердить долговечный термин, границу или инвариант для context,
но сама по себе не подтверждает ADR: Requirement описывает WHAT, а ADR обязан
сохранить принятое решение и WHY, включая реальную альтернативу. Для ADR использовать
принятый Design/owner decision/architecture document. Активный Change допустим в audit
как источник candidate, но его Proposal или Design не становится durable fact до
принятия соответствующего решения. Архивный Change подтверждает завершённый lifecycle,
но его внутренние implementation details всё равно не переносятся в context или ADR.

Code Repository не является источником durable requirement, domain rule или
architecture decision. На initialize он не открывается. В audit/update он допустим
только для проверки одного явно сформулированного current-state conflict через
spec-driven-extended-repository-evidence-scout с полным входным контрактом. Finding из кода
может стать conflict, unknown, TODO или implementation gap, но не durable fact без
решения владельца.

## Классификация

Для каждого утверждения выбрать один результат:

- durable_fact — подтверждено нормативным источником и относится к Store context;
- owner_decision — подтверждено владельцем с ролью и датой;
- conflict — источники расходятся, требуется решение;
- unknown — не хватает owner/expected_source;
- repository_local — принадлежит одному Code Repository, в Store не записывается;
- transient — временное наблюдение, в Store не записывается.

Не переносить в context:

- Requirements, Scenarios, Delta operations или progress Tasks;
- исходники, symbol/module inventory, локальные API/config details;
- build/test/lint commands, CI и packaging одного Repository;
- секреты, персональные данные, стенограммы и неподтверждённые выводы.

## Процедура

1. Зафиксировать mode, пользовательскую цель и переданные selectors.
2. Получить точный список Master Specs через `openspec list --specs --json`. Разрешить
   каждый `--spec` как точный capability path, каждый `--domain` как точный directory
   prefix и не расширять scope за его пределы.
3. Если передан `--change`, прочитать его точные Delta Specs и добавить их capability
   paths к scope. Если exact Change нельзя однозначно разрешить, продолжить только при
   наличии точных `--spec`/`--domain`; иначе вернуть BLOCKER, не искать Change или
   checkout обходом файловой системы.
4. Для ADR triage прочитать только точный active/archived Change, разрешённый внутри
   planning home, и только его Proposal/Design и принятые решения. Если exact path
   неоднозначен или rationale отсутствует, оставить ADR candidate blocked/unknown,
   но не угадывать.
5. По `00-start-here.md` выбрать только тематические context files, относящиеся к
   разрешённым Specs/domains. Проверить существующие facts/TODO и связанные ADR.
6. Отделить facts, owner decisions, conflicts, unknowns, repository-local и transient
   observations. Для каждого возможного ADR отдельно проверить все три условия:
   решение трудно отменить, без объяснения оно неожиданно и была реальная
   альтернатива. Если хотя бы одно условие не подтверждено, ADR не предлагать и
   указать причину в `skipped`.
7. В audit вернуть findings без записи. `context_status: current` допустим и
   означает, что выбранный scope не требует актуализации.
8. В initialize/update сгруппировать proposed_changes по целевому context/ADR file,
   показать точный diff и остановиться со status proposed. Новый ADR именовать
   `NNNN-short-title.md` с номером после максимального существующего; не создавать его
   до подтверждения решения и diff.
9. После отдельного подтверждения записать только показанный блок. Расширение diff
   требует нового подтверждения.
10. Обновлять 00-start-here.md последним и только как навигацию.
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
