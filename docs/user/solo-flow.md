# Поток работы одного человека

Один человек может совмещать роли владельца, аналитика, разработчика и тестировщика,
но границы Planning, Apply, Verify, Release и Archive остаются разными. Change
artifacts и Master Specs принадлежат центральному Store, а реализация и repository
checks — соответствующим Code Repositories.

## 1. Выберите процесс

Создавайте Change из Store и сразу указывайте schema:

```bash
openspec new change <change-id> --schema spec-driven-extended
# либо
openspec new change <change-id> --schema superspec-multirepo
```

| Schema | Поток |
|---|---|
| `spec-driven-extended` | Intent → Intake → Proposal → Specs + опциональный Design → Tasks → Apply → Verify |
| `superspec-multirepo` | Brainstorm → Proposal → Specs + опциональный Design → Tasks → Plan → Apply → Verify |

Для Superspec Brainstorm, Plan, TDD/review discipline и отдельная Process Compliance
обязательны. Intake относится только к `spec-driven-extended`. Apply является
штатным действием OpenSpec, а не отдельным artifact.

Точный следующий artifact и его правила всегда берите из актуальных OpenSpec
`status` и `instructions`. Если одновременно разрешено несколько artifacts, выберите
один из них осознанно. Schema уже созданного Change не переключается: если её порядок
и зависимости больше не подходят, создайте новый Change.

## 2. Подготовьте Planning

### `spec-driven-extended`

До Intake нужен согласованный Intent: принятый Daily Intent Brief, Jira Story или
другой подтверждённый источник с изменением, причиной, ожидаемым результатом,
критериями успеха и ограничениями. Если такого источника нет, остановитесь и
согласуйте Intent; не придумывайте его внутри Intake. Повторно создавать уже принятый
Intent не нужно.

```text
/spec-driven-extended-intake <change-id>
```

Следуйте маршруту из `intake.md`:

- `ready_for_proposal` — переходите к Proposal;
- `explore_recommended` — выполните только указанный Explore, внесите findings в тот
  же `intake.md` и повторно оцените маршрут;
- `blocked` — получите отсутствующее решение владельца.

Затем подготовьте Proposal, Delta Specs, при необходимости Design и Tasks по
актуальным OpenSpec instructions.

### `superspec-multirepo`

Проведите обязательный Brainstorm, рассмотрите альтернативы и получите явное
одобрение результата. Затем подготовьте Proposal, Delta Specs, опциональный Design,
coarse-grained Tasks и подробный repository-scoped Plan. Не создавайте параллельные
документы в `docs/superpowers/`: все результаты принадлежат Change.

### Общие проверки Planning

Repository Impact в Proposal перечисляет только зарегистрированные Code Repositories
с планируемыми изменениями и их точные capabilities. Read-only и review-only
repositories в scope реализации не входят. Design нужен при межрепозиторной
координации, новом dependency, migration, security, performance или существенном
operational risk; не создавайте его только ради заполнения процесса.

Если подключён OpenSpec Graph, запустите проверку из Store:

```bash
openspec-orch plugin exec openspec-graph inspect --json
```

До Apply подтвердите согласованность всех применимых Planning artifacts, точный
repository scope, риски и способ проверки изменённых Scenarios.

## 3. Реализуйте Change

Запускайте штатный OpenSpec Apply из назначенного Code Repository. Для
`spec-driven-extended` Apply следует `tasks.md`; для `superspec-multirepo` — принятому
`plan.md`, включая предусмотренные им worktrees, TDD, проверки и review checkpoints.
Не реализуйте Change в Store.

Если во время Apply обнаружен новый Repository, capability или изменение принятого
scope, остановитесь и сначала обновите Planning. Завершайте task только после
фактического результата и прошедшей проверки, затем создайте implementation commit.
Завершение одного Repository не означает завершение всего Change.

CodeGraph и Change Tracking опциональны. Их отсутствие не блокирует обычный Apply,
repository checks и сбор Git/check evidence. Если Change Tracking подключён к Store
и текущему Code Repository, его Agent Extension автоматически начинает и завершает
attempt для выбранного канонического task.

Без Agent Extension используйте ручной fallback из чистого Code Repository:

```bash
# перед работой над незавершённым task
openspec-orch plugin exec --repo specs change-tracking attempt start <change-id> <task-id>

# после нового commit, repository checks и стандартной галочки OpenSpec
openspec-orch plugin exec --repo specs change-tracking attempt complete <change-id> <task-id>
```

Для `attempt complete` рабочее дерево также должно быть чистым. Plugin связывает task
с planning, base и implementation revisions, но не меняет task status, не создаёт
commit и не выполняет проверки. Если task возвращён в работу, снимите его стандартную
галочку, повторите Apply и сохраните новую attempt; прежняя revision останется в
истории.

## 4. Проведите Verify

Verify — отдельный post-implementation artifact. Его доступность в графе не
доказывает, что Apply candidate собран. Запишите свежие результаты repository checks
и проверки Scenarios; применимая, но не выполненная проверка остаётся `PENDING`, а
`N/A` требует причины.

Agent готовит evidence, но человек явно выбирает Feature Acceptance `PASS` или
`FAIL`. Без этого решения gate остаётся `PENDING`. Для `superspec-multirepo`
дополнительно зафиксируйте Process Compliance: `PASS`, `PASS_WITH_WARNINGS` или
`FAIL`. Verify Superspec завершён только при Feature Acceptance `PASS` и Process
Compliance `PASS` либо `PASS_WITH_WARNINGS`.

Дефект реализации возвращает работу в Apply; drift в Planning — к artifact, который
владеет ошибочным решением. После исправлений или появления нового commit, build или
deployment соберите evidence заново и повторите человеческое решение для текущего
candidate. Verify не выполняет Release или Archive.

## 5. Выполните Release и Archive

После успешного Verify примите отдельное человеческое Release-решение и выполните
фактический Release по правилам проекта. Только после этого запускайте штатный
Archive:

```text
/opsx-archive <change-id>
```

Если используется OpenSpec Graph, выполните `openspec-orch plugin exec openspec-graph inspect --json` из
Store до и после Archive. Archive применяет Delta Specs к Master Specs, но не
выполняется автоматически Agent, Orchestrator или Plugin. Зависимые Changes
архивируйте в dependency order.

Пограничные случаи собраны в [сценариях работы с Change](change-scenarios.md), а
распределение ответственности команды — в [командном потоке](team-flow.md).
