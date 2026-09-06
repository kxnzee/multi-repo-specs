# Release process

## Проектный Git Flow контракт

Store и все Code Repositories должны следовать одной заполненной ниже
конвенции. Имена и patterns выбирает команда; Orchestrator их не валидирует.

| Роль | Имя или pattern в этом проекте | Источник | Цель PR |
|---|---|---|---|
| Production branch | TODO | — | — |
| Integration branch | TODO | Production branch | — |
| Code work branch | TODO | Integration branch | Integration branch |
| Store Story branch | TODO | Integration branch Store | Integration branch Store |
| Store subtask branch | TODO | Store Story branch | Store Story branch |
| Release branch | TODO | Integration branch | Production branch, затем Integration branch |
| Hotfix branch | TODO | Production branch | Production branch, затем Integration branch |

<!-- TODO
question: Какие имена и patterns веток, branch protection, обязательные checks, approvals, merge strategy, теги и обратные слияния приняты для всех repositories?
owner: unassigned
expected_source: Git hosting settings, repository policy, release runbooks, or maintainer confirmation
-->

Store Story branch принимает только PR подзадач. Финальный Story Store PR после
Verify и Archive направляется в Integration branch Store. SDD определяет
содержание и evidence, Git Flow — ветки и продвижение изменений.

Релиз должен продвигать тот же artifact, который прошёл UAT и Gate 3. Его identity
задаётся точными commits и ссылкой на artifact в действующем процессе команды. Замена
commit, build или image после проверки создаёт нового кандидата и требует повторной
проверки.

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

## Archive, UAT и Confluence

- Archive разрешён только после завершения всех реализаций и обязательной ручной
  проверки Scenarios на ИФТ, успешного Verify и Human Gate `PASS`.
- Штатный OpenSpec Archive остаётся владельцем применения Delta Specs к Master Specs
  и перемещения Change. Archive выполняется до UAT и Release через PR в Store.
- До изменения Master Specs требуется сверка Repository Impact, Design, Tasks и Delta
  Specs. Принятый `skip_specs` не требует фиктивной Delta Spec.
- После Archive при наличии долговечного
  domain/architecture/security
  изменения можно выполнить `/spec-driven-extended-context audit --change <change-id>` либо
  передать точные `--spec`/`--domain`. Это необязательный context-promotion шаг:
  `current`, отложенный proposed diff или пропуск аудита не изменяют Master Specs и не
  блокируют Archive. Context и ADR обновляются только после показа diff и отдельного
  подтверждения.
- Если политика проекта требует Confluence, при Archive создаётся или обновляется одна
  производная копия.
- Ключ идемпотентности публикации включает Store, `change-id` и archive revision.
- Confluence-страница содержит ссылку на Jira, архивную Git revision, Specs, Design,
  identity кандидата, release artifact, PR, Zephyr и решения Gate.
- При расхождении источником истины остаётся архивная Git revision OpenSpec Store.
- Сбой обязательной по project policy публикации не изменяет OpenSpec, но Archive
  handoff остаётся незавершённым до успешного повтора.
- После слияния Story Store PR в Integration branch Store Jira Story переводится в
  `Ready to UAT`. Успешный UAT и отдельное решение владельца продукта образуют
  Gate 3 и разрешают Release.
- Дефект UAT против архивированного Scenario требует связанного корректирующего
  Change; прямое исправление Master Specs запрещено, Release блокируется.

<!-- TODO
question: Какой Confluence space, parent page и сервисный credential используются для публикации?
owner: unassigned
expected_source: Confluence administration and security policy
-->
