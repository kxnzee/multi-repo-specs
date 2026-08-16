# Release process

Релиз должен продвигать тот же artifact, который связан со Snapshot успешного Gate
3. Замена commit, build или image после проверки создаёт нового кандидата и требует
повторной проверки.

## Среды и продвижение

<!-- TODO
question: Какие среды существуют и как изменение продвигается между ними?
owner: unassigned
expected_source: Deployment configuration, pipelines, runbooks, or maintainer confirmation
-->

## Миграции и управление включением

<!-- TODO
question: Как выполняются миграции и управляется постепенное включение изменений?
owner: unassigned
expected_source: Runbooks, deployment configuration, or accepted ADRs
-->

## Наблюдение и откат

<!-- TODO
question: Какие сигналы останавливают поставку и как выполняется откат?
owner: unassigned
expected_source: Monitoring, runbooks, incidents, or maintainer confirmation
-->

## Archive и Confluence

- Archive разрешён только после завершения всех реализаций и обязательной ручной
  проверки.
- Штатный OpenSpec Archive остаётся владельцем применения Delta Specs к Master Specs
  и перемещения Change.
- При Archive обязательно создаётся или обновляется одна производная копия в
  Confluence.
- Ключ идемпотентности публикации включает Store, `change-id` и archive revision.
- Confluence-страница содержит ссылку на Jira, архивную Git revision, Specs, Design,
  Snapshot, release artifact, PR, Zephyr и решения Gate.
- При расхождении источником истины остаётся архивная Git revision OpenSpec Store.
- Сбой публикации не изменяет OpenSpec, но Archive handoff остаётся незавершённым до
  успешного повтора.

<!-- TODO
question: Какой Confluence space, parent page и сервисный credential используются для публикации?
owner: unassigned
expected_source: Confluence administration and security policy
-->
