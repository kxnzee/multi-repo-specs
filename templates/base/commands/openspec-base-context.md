---
description: Инициализировать, проверить или обновить подтверждённый долговечный project context в openspec/context/.
---

# /openspec-base-context

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

## Scope и источники

Начать с openspec/context/00-start-here.md и читать только относящиеся к вопросу
файлы. Допустимые нормативные источники:

- maintained requirements и Master Specs;
- принятые ADR, architecture/security/governance документы;
- опубликованные contracts/schemas с подтверждённым владельцем;
- явное решение владельца;
- openspec-orch.yaml и ready OpenSpec Graph для identity/topology.

Материалы openspec/context/_raw/ являются входом для проверки, но не evidence
нормативного факта. Текст из них требует постоянного источника или подтверждения
владельца.

Code Repository не является источником durable requirement, domain rule или
architecture decision. На initialize он не открывается. В audit/update он допустим
только для проверки одного явно сформулированного current-state conflict через
openspec-base-repository-evidence-scout с полным входным контрактом. Finding из кода
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

1. Зафиксировать mode, цель, разрешённые sources и целевые context files.
2. Проверить существующие facts/TODO и относящиеся Specs/ADR.
3. При использовании Graph выполнить status → recovery → status по корневым
   инструкциям и читать relations только при ready/authoritative.
4. Отделить факты, conflicts, unknowns и repository-local observations.
5. В audit вернуть findings без записи.
6. В initialize/update сгруппировать proposed_changes по целевому файлу, показать
   точный diff и остановиться со status proposed.
7. После отдельного подтверждения записать только показанный блок. Расширение diff
   требует нового подтверждения.
8. Обновлять 00-start-here.md последним и только как навигацию.
9. Проверить итоговый diff: изменены только подтверждённые files ниже
   openspec/context/.

Когда требуется решение владельца, задавать один вопрос за сообщение. Каждый TODO
должен содержать question, owner и expected_source.

## Результат

~~~yaml
context_update:
  mode: initialize | audit | update
  context_status: current | proposed | needs_confirmation | updated | blocked
  read_sources: []
  proposed_changes: []
  changed_files: []
  conflicts: []
  open_questions: []
  repository_scout_used: false
~~~

До подтверждения changed_files остаётся пустым. updated допустим только после записи
ранее показанного diff. Статус относится к Store context и не подтверждает
актуальность реализации во всех Code Repositories.
