---
description: "Создать OpenSpec Change и согласовать Proposal после Explore"
---

Первое сообщение всегда начни на русском языке. Всегда общайся с пользователем на русском языке. Не переводи код, команды, пути, идентификаторы, имена полей и обязательные машинные значения.

Команда вызывается как `/sdd-change <ticket-id> <short-name>` из центрального Store после завершённого Explore. Она объединяет создание стандартного OpenSpec Change и подготовку `proposal.md`, но не создаёт Delta Specs, `design.md`, `tasks.md`, код, commit, push или PR.

## Обязательный вход

До запуска потребуй одновременно:

- ровно два аргумента: Jira ticket key в верхнем регистре и короткое имя в lowercase kebab-case;
- полный структурированный итог `/opsx-explore` в текущей агентской сессии;
- явное решение Change Owner, что Explore завершён и можно создать Change и Proposal;
- отсутствие блокирующих вопросов.

Проверь, что ticket аргумента совпадает с ticket структурированного итога Explore. Не восстанавливай Explore из Jira, истории других сессий, существующего Change или пересказа пользователя. Если текущая сессия не содержит полного результата, остановись и попроси повторить `sdd explore` и оригинальный `/opsx-explore`.

## 1. Создай или разреши каркас Change

Выполни только детерминированную команду:

```bash
sdd change --ticket <ticket-id> --name <short-name> --store <store-id>
```

`<store-id>` возьми только из структурированного итога Explore. CLI не переключает Store по этому параметру, а проверяет, что он совпадает с текущим центральным checkout.

Разбери единственный JSON из stdout. Требуй:

- `changeStatus` равен `created` или `existing`;
- `storeId`, `storeRoot`, `changeId`, `branch`, `baseRevision` и `changePath` непусты;
- `storeId` совпадает со Store структурированного итога Explore;
- `changeId` равен `<ticket-lowercase>-<short-name>`;
- `branch` равна `feature/<changeId>`;
- `schema` равна `spec-driven`;
- `proposalStatus` равен `missing` или `present`;
- `nextAction` согласован с состоянием Proposal;
- вложенный `openSpecStatus` относится к тому же Store, Change и schema.

Не исправляй ошибку CLI через ручное создание каталога, `.openspec.yaml`, ветки, reset, stash, merge или rebase. При `needs_recovery` покажи причину и остановись.

## 2. Получи официальные instructions Proposal

Выполни:

```bash
openspec instructions proposal \
  --change <changeId> \
  --store <storeId> \
  --json
```

Проверь, что ответ содержит тот же OpenSpec root и Store ID, `changeName`, `schemaName: spec-driven`, `artifactId: proposal`, ожидаемый `changeDir`, `outputPath: proposal.md`, разрешённый `resolvedOutputPath`, непустой `template` и выполненные зависимости. `skipped: true`, другой root, другой output path или выход пути за `changePath` блокируют запись.

## 3. Подготовь Proposal

Используй только:

- подтверждённый структурированный итог Explore текущей сессии;
- `openspec/context/00-start-here.md` и направленный им контекст центрального Store;
- подходящие Master Specs, прочитанные с явным `--store <storeId>`;
- template, context и rules из официальных instructions.

Не перечитывай Code Repositories и не обращайся к Jira API. Сохрани только сведения, необходимые для planning:

- исходный Jira ticket;
- проблему, ценность и ожидаемый наблюдаемый результат;
- scope и out of scope;
- Store, репозитории-кандидаты и внешние системы;
- риски совместимости;
- существенные источники и точные ревизии Explore;
- оставшиеся неблокирующие вопросы.

В разделах Why, What Changes, Capabilities, Impact, рисках и открытых вопросах описывай только наблюдаемое поведение, ценность, scope, системы и репозитории-кандидаты. Не указывай файлы, каталоги, классы, функции, хуки, внутренние модули, библиотеки, команды, технологии, алгоритмы, форматы парсинга и локальные шаги реализации. Не объявляй репозиторий окончательно затронутым до Design.

Технические имена из Explore допустимы только в отдельном разделе источников как evidence с точной ревизией. Они не становятся частью обещанного решения. Открытый вопрос не должен повторять или опровергать уже принятое утверждение Proposal и не должен переносить в Design выбор файла, библиотеки, команды или другого локального способа реализации; такие детали просто не включай в Proposal.

Перед показом Proposal Change Owner перечитай все разделы и перепиши найденные технические решения и противоречия. Не выдавай предположение за факт, не закрепляй преждевременно реализацию и не переноси историю чата. Записывай только в проверенный `resolvedOutputPath`. Если `proposalStatus: present`, сначала прочитай существующий Proposal и не перезаписывай подтверждённый текст без явного изменения Change Owner.

## 4. Получи человеческое подтверждение

Покажи Change Owner полный Proposal. До явного подтверждения не объявляй шаг завершённым и верни `proposal_status: needs_confirmation`. Если уточнение меняет scope, требует нового репозитория, новой ревизии или дополнительного исследования, остановись и верни процесс к шагу 01.

После подтверждения ещё раз выполни:

```bash
openspec status --change <changeId> --store <storeId> --json
```

Проверь, что Proposal имеет статус `done`, а Specs, Design и Tasks ещё не имеют статуса `done` или `skipped`. Не создавай последующие артефакты.

## Итоговый отчёт

После явного подтверждения выведи:

```text
step_status: proposal_accepted
change_status: <created|existing>
store_id: <storeId>
ticket: <ticket-id>
change_id: <changeId>
branch: <branch>
schema: spec-driven
proposal_status: accepted
next_step: 03
```

Встроенные команды и skills `opsx-*` не изменяй и `/opsx-propose` не вызывай.
