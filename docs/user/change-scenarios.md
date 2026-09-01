# Сценарии работы с Change

Эта страница помогает выбрать следующий шаг в типовых и пограничных ситуациях.
Точный порядок artifacts и их правила всегда берите из schema текущего Change через
`openspec status` и `openspec instructions`. Orchestrator и Plugins не создают
параллельный workflow.

## Выбор процесса и старт

| Ситуация | Действие |
|---|---|
| Нужен стандартный spec-driven процесс | Выбрать `spec-driven-extended`: Intake → Proposal/Specs/опциональный Design → Tasks → Apply → Verify |
| Нужны обязательный Brainstorm, подробный Plan, TDD/review discipline и отдельная Process Compliance | Выбрать `superspec-multirepo`: Brainstorm → Proposal/опциональный Design/Specs → Tasks → Plan → Apply → Verify |
| Schema уже выбрана, но её порядок и зависимости артефактов больше не подходят | Не переключать schema существующего Change; создать новый Change и перенести только принятый смысл |
| Для `spec-driven-extended` уже есть принятый Intent | Перейти к Intake и не создавать Intent повторно |
| Для `spec-driven-extended` согласованного Intent нет | Остановиться до Intake и получить или согласовать Intent; не придумывать его внутри Intake |
| Выбран `superspec-multirepo` | Провести обязательный Brainstorm и получить явное одобрение результата до следующих artifacts |
| OpenSpec разблокировал ровно один следующий artifact | Подготовить этот artifact по актуальным instructions |
| OpenSpec одновременно разблокировал несколько artifacts | Не угадывать порядок; человек выбирает один из разрешённых artifacts |
| Artifact имеет статус `blocked` | Сначала устранить blocker или получить требуемое решение владельца |

Подробнее о порядке артефактов и смене schema: [Project Template](project-template.md).

## Intake и Planning

| Ситуация | Действие |
|---|---|
| Intake завершён, маршрут `ready_for_proposal` | Перейти к Proposal |
| Intake завершён, маршрут `explore_recommended` | Выполнить только указанный Explore, классифицировать findings и обновить тот же `intake.md`; не продолжать автоматически |
| Intake завершён, маршрут `blocked` | Остановиться и получить продуктовое решение владельца |
| Нужно подтвердить текущее состояние на разрешённой Planning-стадии | Выполнить адресное исследование выбранного Repository; facts вернуть в Planning, не превращая особенности кода в Requirements |
| Техническое решение простое и не требует отдельного обоснования | Не создавать опциональный Design только потому, что он доступен в schema |
| Есть межрепозиторная координация, новый dependency, migration, security, performance или существенный operational risk | Подготовить Design до Tasks |
| В Design остался вопрос, меняющий Specs, подход или Tasks | Разрешить его до Tasks; не маскировать решение как отложенный open question |
| Новое наблюдаемое поведение | Добавить полный Requirement в `ADDED Requirements` |
| Меняется существующее поведение | Скопировать весь существующий Requirement со всеми Scenarios в `MODIFIED Requirements` и отредактировать итоговый контракт |
| Поведение удаляется | Использовать `REMOVED Requirements` и указать `Reason` и `Migration` |
| Меняется только имя Requirement | Использовать `RENAMED Requirements` с `FROM:` и `TO:` |
| В `spec-driven-extended` добавляется новый Scenario | Дать ему стабильный суффикс `<change-id>-<three-digit-index>` и оформить заголовком уровня `####` с WHEN/THEN |
| Поведение не меняется: только refactor, tooling или docs | Зафиксировать `skip_specs: true`; не создавать фиктивный Requirement |
| В `spec-driven-extended` создаётся новая capability | Добавить в Delta Spec содержательный `Purpose` |
| В `spec-driven-extended` у существующей capability отсутствует или устарел `Purpose` | Заблокировать текущий Change и оформить отдельную принятую Store-операцию; не править Master Spec напрямую |
| Repository нужен только для чтения или review | Не включать его в Repository Impact, Design map и Tasks |
| В Proposal указан неизвестный Repository или capability | Исправить Planning; Orchestrator не регистрирует и не добавляет scope автоматически |

Proposal и Specs являются Store-only стадиями. Код допустимо исследовать только там,
где это разрешают instructions текущего artifact. Repository Impact содержит лишь
зарегистрированные Code Repositories с планируемыми изменениями и точное соответствие
их capabilities.

## Apply и несколько repositories

| Ситуация | Действие |
|---|---|
| Planning scope, Delta Specs и repository Tasks согласованы | Запустить штатный OpenSpec Apply из назначенного Code Repository |
| Во время Apply найден новый Repository, capability или изменение принятого scope | Остановить Apply, обновить соответствующие Planning artifacts и повторно принять Planning; в командном процессе повторить Gate 1 |
| Graph недоступен и assignment равен `null` | Прочитать Proposal через MCP resource и подтвердить текущий repository по строгой таблице Repository Impact |
| Assignment не совпадает с Repository Impact или repository section Tasks | Не продолжать Apply до исправления Planning или выбора правильного Repository |
| CodeGraph отсутствует, устарел или индексирует другую revision | Использовать адресный read/search в текущем Repository; не запускать sync автоматически |
| Task имеет фактические artifacts и прошедшие checks | Отметить Task выполненным и сохранить конкретное evidence |
| Task заблокирован или проверка не выполнена | Оставить checkbox открытым и зафиксировать blocker; план проверки не считать результатом проверки |
| Change Tracking подключён | Agent Extension или ручной fallback связывает task с implementation revision, но не меняет task status и не выполняет проверки |
| Change Tracking не подключён или недоступен | Продолжить обычный Apply и сохранить Git/check evidence без attempt history |
| Task возвращён в доработку | Снять его стандартную галочку, повторить Apply и после новой implementation revision сохранить новую attempt, если Tracking подключён |
| Независимые repository scopes не имеют общей state, пересекающихся файлов и зависимости по порядку | В `superspec-multirepo` их можно выполнять параллельно, если это явно разрешает Plan |
| Между repository scopes есть зависимость или общие файлы | Выполнять их последовательно в порядке из Plan |
| Завершены Tasks одного Repository | Зафиксировать только repository completion; не объявлять весь Change реализованным |

Change Tracking и CodeGraph опциональны. Их отсутствие не отменяет OpenSpec scope,
repository checks и evidence. Подробности: [Plugins](plugins.md).

## Verify, Release и Archive

| Ситуация | Действие |
|---|---|
| OpenSpec показывает Verify доступным, но Apply candidate ещё не собран | Не считать доступность Verify доказательством реализации; сначала завершить Apply и собрать candidate |
| Проверка выявила дефект реализации или падающий repository check | Вернуться в Apply, исправить реализацию и заново собрать evidence |
| Verify выявил drift в Proposal, Specs, Design, Tasks или Plan | Вернуться к artifact, который владеет ошибочным решением, повторно пройти зависимые стадии и Verify |
| Техническое evidence собрано, но решения человека ещё нет | Оставить Feature Acceptance в `PENDING`; Agent и Plugins не могут установить `PASS` |
| Человек установил Feature Acceptance `FAIL` | Вернуться к владельцу причины отказа — Planning artifact или Apply — и после исправления провести новый Verify |
| Для Superspec Feature Acceptance равен `PASS`, а Process Compliance — `PASS` или `PASS_WITH_WARNINGS` | Verify завершён; warning должен остаться явно записанным |
| Появился новый commit, build или deployment после проверки | Считать прежнее подтверждение устаревшим, обновить evidence и повторить человеческую проверку текущего candidate |
| Verify завершён | Получить отдельное человеческое Release-решение; Verify сам не выполняет Release или Archive |
| Фактический Release завершён | Выполнить штатный Archive; при подключённом Graph проверить Store до и после Archive |
| Несколько Changes зависят друг от друга | Архивировать их в dependency order, чтобы Delta Specs применялись к ожидаемому состоянию Master Specs |
| Нужен ранний Sync до реализации зависимого Change | Оформить его отдельным reviewable PR; не считать Sync доказательством реализации или deployment |

Командные gates описаны в [командном потоке](team-flow.md), сокращённый процесс — в
[потоке одного человека](solo-flow.md).

## Изменение project workflow

| Ситуация | Действие |
|---|---|
| Template получил совместимые уточнения инструкций | Перенести их в Store отдельным проверяемым PR; повторный `init` скопированные файлы не обновит |
| Меняются порядок или зависимости артефактов, а старую schema используют активные Changes | Сохранить старую schema под прежним ID, установить новую под новым ID и использовать её только для новых Changes |

Процедура переноса описана в [установке и обновлениях](installation-and-updates.md).

## Инварианты

- Requirements, Scenarios, Change artifacts и Master Specs принадлежат центральному
  Store; реализация и repository checks принадлежат Code Repositories.
- Explore и code evidence подтверждают факты, но не принимают продуктовые решения и
  не расширяют scope.
- Planning, Apply, Verify, Release и Archive — разные границы полномочий; успешное
  завершение одной стадии не выполняет следующую автоматически.
- Graph показывает структуру Store, но не доказывает ownership, реализацию, runtime
  dependency или deployment.
- Archive не выполняется автоматически Orchestrator, Plugin или Agent.
