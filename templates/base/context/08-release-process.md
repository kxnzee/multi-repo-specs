# Release process

Релиз должен продвигать тот же artifact, который прошёл Gate 3. В Standard flow его
identity задаётся точными commits и ссылкой на artifact в действующем процессе
команды; при Change Tracking — текущим Snapshot. Замена commit, build или image после
проверки создаёт нового кандидата и требует повторной проверки.

Центральный контекст хранит общую политику продвижения и отката. Конкретные команды,
конфигурация, метрики и процедура поставки компонента принадлежат его Code Repository.

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
- До изменения Master Specs требуется `graph inspect --json` с `errors: 0` и сверка
  Repository Impact, Design, Tasks и при наличии Cycle repositories. Отсутствующий
  Store binding блокирует Archive. `CYCLE_NOT_FOUND` разрешает проверить scope по
  принятым Repository Impact и Tasks; принятый `skip_specs` не требует фиктивной
  Delta Spec.
- После Archive `graph inspect --json` выполняется повторно. Архивный Change должен
  сохранять нейтральные Repository–Master Spec связи, автоматически полученные из
  Repository Impact и Delta Specs. Ошибка post-Archive inspect блокирует Graph
  handoff, но не откатывает штатный Archive автоматически.
- После Archive и успешного Graph handoff при наличии долговечного
  domain/architecture/security
  изменения можно выполнить `/openspec-base-context audit --change <change-id>` либо
  передать точные `--spec`/`--domain`. Это необязательный context-promotion шаг:
  `current`, отложенный proposed diff или пропуск аудита не изменяют Master Specs и не
  блокируют Archive. Context и ADR обновляются только после показа diff и отдельного
  подтверждения.
- Если политика проекта требует Confluence, при Archive создаётся или обновляется одна
  производная копия.
- Ключ идемпотентности публикации включает Store, `change-id` и archive revision.
- Confluence-страница содержит ссылку на Jira, архивную Git revision, Specs, Design,
  identity кандидата, release artifact, PR, Zephyr и решения Gate. Snapshot указывается
  только для Change Tracking flow.
- При расхождении источником истины остаётся архивная Git revision OpenSpec Store.
- Сбой обязательной по project policy публикации не изменяет OpenSpec, но Archive
  handoff остаётся незавершённым до успешного повтора.

<!-- TODO
question: Какой Confluence space, parent page и сервисный credential используются для публикации?
owner: unassigned
expected_source: Confluence administration and security policy
-->
