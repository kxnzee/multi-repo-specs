# Jira, Zephyr и Confluence без расширения Core

До ревизии Alpha внешние интеграции реализуются вне Orchestrator Core. Этот документ
фиксирует минимальные контракты; конкретный API, edition продукта, CI-платформа и
credentials должны быть выбраны отдельно.

## Jira

Минимальная связь:

- Jira Story содержит `change-id` и ссылку на Planning PR;
- Change содержит Jira key в Proposal;
- implementation PR ссылается на Change и Scenario/Task IDs;
- Jira показывает ссылки на Gate evidence, release и Confluence, но не дублирует
  нормативный текст Requirements.

## Zephyr

Исходником тестового покрытия являются OpenSpec Scenarios и результат skill
`openspec-test-cases`. Нейтральная запись для будущего adapter содержит:

```text
case_id
title
change_id
scenario_ids[]
repository_ids[]
level
preconditions
steps[]
expected_result
automation_priority
snapshot_id
```

Adapter обязан:

- использовать стабильный `case_id` как ключ upsert;
- не считать экспортированный case выполненным;
- связывать execution с конкретным Snapshot;
- возвращать внешний ID и URL;
- не изменять OpenSpec Scenario из Zephyr автоматически;
- поддерживать dry-run и идемпотентный повтор.

До выбора Zephyr edition skill возвращает нейтральные данные и не угадывает CSV или
API-схему продукта.

## Confluence Archive

Публикуется производная копия уже архивированного Change. Ключ upsert:

```text
<store-id>/<change-id>/<archive-revision>
```

Обязательное содержимое страницы:

- Jira Story и `change-id`;
- archive revision и ссылка на Store;
- итоговые Specs, Proposal и Design;
- точные implementation commits и Snapshot;
- IFT, QA/Zephyr и решения Gate;
- release artifact и дата релиза.

Publisher обязан поддерживать dry-run, retry, обнаружение существующей страницы и
явный результат `published | unchanged | failed`. Ошибка публикации не откатывает и
не переписывает OpenSpec Archive, но оставляет внешний handoff незавершённым.

## Что нужно выбрать до реализации adapters

- Jira и Zephyr product/edition и доступный API;
- Confluence Cloud или Data Center, space и parent page;
- CI-платформу и место хранения secrets;
- identity сервисного пользователя;
- где хранить ссылки и статус публикации до появления Orchestrator Plugin API.
