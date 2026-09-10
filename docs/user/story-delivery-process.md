# Единый процесс работы над Jira Story

Этот документ задаёт единый процесс от требования потребителя до Release и заменяет
отдельные командный и одиночный потоки. Он разделяет Jira, OpenSpec SDD и Git Flow:
Jira управляет работой людей, OpenSpec — требованиями и evidence, Git Flow —
поставкой кода.

Термины `Jira Story`, `Store Story branch`, `Code PR`, `Subtask Store PR` и
`Story Store PR` определены в [конце этого документа](#термины).

## Единая Git Flow конвенция

Этот процесс применяется в проектах, явно выбравших Jira Story и Git Flow.
Универсальный Project Template не устанавливает его автоматически: принятые правила
проекта заполняются в `openspec/process/`. Перенос файлов не меняет принятый процесс.

Git Flow обязателен для центрального Store и всех Code Repositories одного
проекта. Команда один раз заполняет Git-контракт в
`openspec/process/release-process.md`; все репозитории следуют его ролям
веток и направлениям PR. Конкретные имена и префиксы задаёт команда,
а не Orchestrator.

| Логическая роль | Создаётся от | PR направляется в | Назначение |
|---|---|---|---|
| Production branch | — | — | Состояние, выпущенное в production |
| Integration branch | Production branch при создании репозитория | — | Интеграция следующих изменений и источник Release |
| Code work branch | Integration branch | Integration branch | Реализация подзадачи в Code Repository |
| Store Story branch | Integration branch Store | Integration branch Store | Интеграция Planning, Tasks, evidence и Archive одной Jira Story |
| Store subtask branch | Store Story branch | Store Story branch | Изменение Store в рамках отдельной подзадачи |
| Release branch | Integration branch | Production branch, затем обратно в Integration branch | Стабилизация и публикация Release |
| Hotfix branch | Production branch | Production branch, затем обратно в Integration branch | Срочное исправление выпущенной версии |

Например, команда может выбрать `main`/`develop`/`feature/*` или
`master`/`dev`/`work/*`. Это примеры, а не встроенные разрешённые имена.

Во всех репозиториях действуют одинаковые ограничения:

- прямые commit и push в Production и Integration branches запрещены;
- изменение попадает в целевую ветку только через PR, review и обязательные checks;
- Production и Integration branches защищены от force-push и удаления;
- рабочая ветка удаляется после слияния;
- Release и Hotfix получают Git-тег версии после слияния в Production branch;
- отклонение от конвенции оформляется как временное исключение с владельцем, сроком
  и планом возврата, а не как локальное правило Repository.

SDD и Git Flow не смешиваются: SDD определяет требуемое поведение и evidence, а Git
Flow — ветки и продвижение одного и того же изменения. Git Flow действует на всех
этапах: work branches используются во время Planning и Apply, Release branch — только
после успешного UAT и Gate 3.

## Роли

| Роль | Ответственность |
|---|---|
| Владелец продукта | Решение брать требование или нет, продуктовый scope, UAT и Release-решение |
| Аналитик | Discovery, все Planning-артефакты, Jira-декомпозиция, Store Story branch и Archive |
| Разработчик | Review Planning, реализация назначенной подзадачи, Code PR и Subtask Store PR |
| Тестировщик | Review Planning, ИФТ, проверка Scenarios, Zephyr evidence, Verify и Human Gate |
| Лид разработки | Review Planning и рисков реализации, разрешение технических blockers |

Three Amigos — аналитик, разработчик и тестировщик. Лид разработки подключается к
Planning PR дополнительно и не заменяет ни одну из этих ролей.

Роли обозначают ответственность, а не учётные записи или ACL Orchestrator. В
небольшой команде один человек может совмещать несколько ролей, включая все роли в
одиночном процессе. При этом Planning, Apply, Verify, Archive, UAT и Release остаются
разными решениями с отдельным evidence. Неизвестный владелец решения, бессрочное
исключение или Human Gate, принятый только Agent, считаются blocker.

## 1. Приём требования

1. Потребитель создаёт задачу в Jira.
2. Владелец продукта решает, брать требование в работу или нет.
3. Если требование принято, владелец продукта создаёт Jira Story с исходными
   требованиями и создаёт в ней подзадачу аналитика.

## 2. Discovery

1. Jira Story находится в статусе `Discovery`.
2. Аналитик собирает и уточняет требования у потребителей.
3. Когда требований достаточно для начала SDD, аналитик переводит свою подзадачу в
   работу и создаёт связанный OpenSpec Change.
4. От Integration branch Store создаётся Store Story branch по проектному
   pattern. Прямые изменения этой ветки запрещены: она обновляется
   только через PR подзадач.

Аналитик выбирает схему и создаёт Change по
[сценариям Change](../templates/default.md#выбор-процесса-и-старт). Схему
существующего Change не переключают.

## 3. Planning

1. Аналитик готовит Planning по правилам выбранной схемы. Состав артефактов,
   переходы между ними и правила Gate 1 описаны в
   [сценариях Change](../templates/default.md#сценарии-работы-с-change).
2. Аналитик создаёт от Store Story branch ветку по pattern для
   Store subtask branch и открывает Planning PR обратно в Store Story
   branch.
3. Весь PR ревьюят разработчик, тестировщик и лид разработки. Аналитик устраняет
   замечания и сохраняет согласованность всех Planning-артефактов.
4. После approvals, строгой OpenSpec-валидации и Gate 1 Planning PR сливается в Store
   Story branch.

Gate 1 относится к точной ревизии Planning PR. Изменение принятого поведения,
Repository Impact, Design, Tasks или Plan требует нового Planning PR и нового Gate 1.
Git-процесс не заменяет проверок схемы и человеческого решения по Planning.

## 4. Декомпозиция в Jira

1. После слияния Planning PR аналитик создаёт подзадачи разработки согласно
   `tasks.md`.
2. Обычно работа каждого Code Repository оформляется отдельной подзадачей. Если в
   одном Repository нужно несколько подзадач, их связь с пунктами `tasks.md` должна
   оставаться однозначной.
3. Исполнители назначаются из участников Jira Story.
4. Для ИФТ и Verify создаётся подзадача тестировщика.

Jira-подзадачи управляют назначением и статусом работы, а `tasks.md` остаётся
каноническим планом реализации OpenSpec Change.

## 5. Начало разработки

Каждый разработчик берёт назначенную подзадачу в работу и выполняет её только в
указанном Code Repository. От Integration branch создаётся Code work branch
по проектному pattern. Один OpenSpec `change-id` указывается в Jira,
ветках и PR вместе с Jira key, если это не нарушает ограничение Git-сервера на длину
имени.

Assignment, Repository Impact и соответствующая секция Tasks или Plan должны
совпадать. Если во время Apply обнаружен новый Repository, capability или изменение
принятого scope, разработка останавливается до обновления Planning и повторного
Gate 1.

## 6. План реализации объёмной подзадачи

Разработчик до Apply готовит отдельный план реализации, если выполняется хотя бы одно
условие:

- в одном Code Repository затронуто более 10 Scenarios;
- меняются несколько модулей или публичный контракт;
- требуются миграция данных, security-решение или нетривиальный rollback;
- план потребовал лид разработки во время Planning review.

План размещается в описании Code PR или в закреплённом комментарии. Для небольшой
подзадачи достаточно шагов и проверок из `tasks.md`. Порог в 10 Scenarios является
стартовым правилом и пересматривается после пилота по фактической сложности задач.

## 7. Apply и PR подзадачи

1. Разработчик запускает штатный OpenSpec Apply из назначенного Code Repository.
2. Если подключён Change Tracking, разработчик читает существующие связи задачи с PR
   и продолжает работу по опубликованному плану.
3. Разработчик реализует task, выполняет repository checks, создаёт commit и отмечает
   task выполненным.
4. Разработчик создаёт Code PR в Integration branch соответствующего Code
   Repository. В описании
   указываются Jira Story, подзадача, `change-id`, план реализации и результаты
   проверок.
5. После review Code PR сливается в Integration branch. Точный implementation commit
   и identity
   собранного artifact сохраняются как evidence.
6. После слияния кода разработчик создаёт от Store Story branch ветку
   по pattern для Store subtask branch и открывает Subtask Store PR обратно в Store
   Story branch с обновлёнными Tasks и implementation evidence. Прямое изменение
   Store Story branch запрещено.

Разработчик создаёт два разных PR: один с кодом в Code Repository, второй с
OpenSpec-изменениями своей подзадачи в Store. Разработка подзадачи считается
завершённой после слияния Code PR и создания Subtask Store PR.

В описании Code PR фиксируются Change, Jira Story и подзадача, Repository и его
OpenSpec tasks, связанные PR других repositories, план реализации, результаты
repository checks и известные blockers. Для candidate используются полные commit SHA
и identity собранного build или deployment: имя ветки, номер задачи или последний
commit в PR недостаточны.

Завершение Tasks одного Repository означает только repository completion. Весь
Change готов к ИФТ после сведения всех запланированных результатов в один candidate.
Производные DTO, API clients, OpenAPI/JSON Schema и fixtures не становятся отдельным
источником требований. Межрепозиторная проверка покрывает типы и обязательность
полей, `null`, enum, error contracts, совместимость версий, миграцию и сквозные
Scenarios между producer и consumers.

В `superspec-multirepo` независимые repository scopes выполняются параллельно только
когда Plan явно это разрешает и между ними нет общей state, порядка выполнения или
пересекающихся файлов. Rollout не должен создавать несовместимое состояние producer
и consumers.

### Частичная передача работы

Change Tracking опционален и не меняет описанный выше Git-процесс. Из Code
Repository исполнитель вызывает `start <change-id> <task-id>`, реализует задачу
и сохраняет committed результат через `checkpoint`. Галочка остаётся открытой.
При необходимости короткая `--note` объясняет следующий шаг.

Для передачи публикуются Code commit и Store map через принятый командой процесс,
в том числе Subtask Store PR. Ссылки на PR в карту не записываются. Получатель
читает Change и checkpoint, получает сохранённый commit обычным Git, подготавливает
его checkout и вызывает тот же `start`. Исходное локальное состояние не нужно.

После всех работ, проверок и стандартной галочки OpenSpec вызывается `complete`.
Это не Verify, не слияние и не приёмка. Один commit может относиться к нескольким
задачам. Без Tracking Apply работает штатно, а evidence передаётся командным каналом.
Подробности — [Change Tracking](../plugins/change-tracking.md#один-процесс-работы).

## 8. ИФТ, Verify и дефекты

1. После объединения реализаций формируется один Implementation candidate с точными
   revisions и artifact identity. Это Gate 2: Code PR прошли review и repository
   checks, зависимости сведены, candidate развёрнут на ИФТ.
2. Тестировщик берёт подзадачу в работу и проверяет candidate на ИФТ.
3. Каждый применимый Scenario из Delta Specs проверяется на этом candidate. При
   использовании Zephyr execution связывается со Scenario ID и candidate identity.
4. Результаты заносятся в `verify.md` через Subtask Store PR.
5. Тестировщик явно устанавливает Human Gate `PASS` или `FAIL`. Agent может собрать
   evidence, но не принимает это решение.
6. Подзадача тестирования закрывается только после успешного Verify, `PASS` и слияния
   относящегося к ней Store PR.

Gate 2 фиксирует кандидата, но не подтверждает результат ИФТ. Новый commit, build или
deployment создаёт нового candidate и требует повторных Gate 2, проверки и Human
Gate. Для `superspec-multirepo` Verify завершается только при Feature Acceptance
`PASS` и Process Compliance `PASS` либо `PASS_WITH_WARNINGS`; предупреждения
записываются явно.

### Классификация найденного дефекта

| Ситуация | Действие |
|---|---|
| Реализация не выполняет существующий Scenario | Создать Bug, вернуть работу в Apply, собрать новый candidate и повторить Verify |
| Scenario отсутствует, но следует из уже принятого требования | Считать это Planning drift, дополнить Delta Specs через PR, повторить Gate 1, Apply и Verify |
| Обнаружено новое требование | Владелец продукта решает включить его в текущую Jira Story или создать отдельные Jira Story и OpenSpec Change |

Причина дефекта — ошибка человека, Agent или review — фиксируется отдельно и не
заменяет классификацию относительно принятой спецификации.

## 9. Archive и Ready to UAT

1. Все Code PR слиты, подзадачные Store PR объединены в Store Story branch, Verify
   завершён с `PASS`; открытой остаётся подзадача аналитика.
2. Аналитик запускает штатный OpenSpec Archive в Store subtask branch
   от Store Story branch и создаёт Subtask Store PR с результатом Archive
   обратно в Store Story branch.
3. После слияния Archive PR аналитик создаёт Story Store PR из Store Story branch в
   Integration branch Store.
4. После review и слияния Story Store PR аналитик закрывает свою подзадачу.
5. Когда все подзадачи закрыты, Jira Story переводится в `Ready to UAT`.

Archive фиксирует принятую после ИФТ нормативную версию требований, но не выполняет
UAT и не разрешает Release автоматически. Если UAT обнаружил несоответствие уже
архивированному Scenario, создаётся связанный корректирующий OpenSpec Change, а
Release блокируется до его прохождения. Master Specs напрямую не редактируются.

Если подключён OpenSpec Graph, команда
`openspec-orch plugin exec openspec-graph inspect --json` выполняется из Store до и
после Archive. Зависимые Changes архивируются в dependency order. Необходимый
зависимому Change ранний Sync оформляется отдельным reviewable PR; он не доказывает
реализацию или deployment и не заменяет Archive.

## 10. UAT и Release по Git Flow

1. Потребители выполняют UAT для Jira Story.
2. После успешного UAT команда проходит Gate 3, а владелец продукта принимает
   Release-решение. Gate 3 подтверждает отсутствие блокирующих дефектов, готовность
   rollout, наблюдения и rollback, необходимые security, migration, SLO и operational
   approvals, а также точную identity проверенного artifact.
3. В Store и каждом выпускаемом Code Repository из Integration branch создаётся
   Release branch по единому проектному pattern.
4. Release candidate проходит обязательные проверки проекта.
5. Release branch сливается в Production branch и обратно в Integration branch,
   затем версия фиксируется Git-тегом.
6. Выпускается тот же artifact, который прошёл итоговые проверки. Замена commit,
   build или image создаёт нового кандидата и требует повторного решения.

Git Flow выполняется средствами Store, Code Repositories и CI/CD. OpenSpec
Orchestrator не создаёт ветки, PR, теги, Jira-подзадачи, Zephyr executions и Release.

Hotfix начинается от Production branch, проходит отдельный PR и обязательные checks,
получает тег в Production branch, затем обязательно сливается обратно в
Integration branch. Если Hotfix меняет
наблюдаемое поведение, связанный OpenSpec Change и обновление Store обязательны:
срочность не отменяет трассировку требований.

## Применение процесса одним человеком

Для одиночной работы не используется сокращённый жизненный цикл: выполняются те же
10 этапов и те же проверки. Один человек может последовательно выступать владельцем
продукта, аналитиком, разработчиком и тестировщиком, но должен отдельно зафиксировать
Planning revision, implementation candidate, результаты Verify, Human Gate, Archive,
UAT и Release-решение. Совмещение ролей не превращает техническое evidence в
автоматическое человеческое одобрение.

## Обязательные связи

Для одной поставки должна восстанавливаться цепочка:

```text
Jira Story
→ OpenSpec Change
→ Jira subtask
→ OpenSpec task
→ Code Repository и Code PR
→ implementation revision и artifact
→ Scenario evidence и Verify
→ Archive revision
→ UAT
→ Release tag
```

## Термины

| Термин | Значение |
|---|---|
| Jira Story | Принятая владельцем продукта единица поставки, объединяющая требования, участников и подзадачи. |
| OpenSpec Change | Нормативный набор Planning-артефактов и Delta Specs, связанный с Jira Story. |
| Store | Git-репозиторий с OpenSpec Changes, Master Specs и проектным контекстом. |
| Specs Repository | Store другой команды, подключённый как источник спецификаций и контекста. |
| Code Repository | Git-репозиторий с реализацией компонента без локальной копии нормативного OpenSpec Change. |
| Store Story branch | Временная интеграционная ветка Jira Story в Store; Planning, обновления подзадач и Archive попадают в неё через PR. |
| Subtask Store PR | PR из ветки подзадачи в Store Story branch с Planning, Tasks или evidence этой подзадачи. |
| Code PR | PR с реализацией подзадачи в Integration branch соответствующего Code Repository. |
| Story Store PR | Финальный PR из Store Story branch в Integration branch Store после Verify и Archive. |
| Git Flow | Единая для Store и Code Repositories модель веток Production, Integration, work, Release и Hotfix. Конкретные имена задаёт команда. |
| Implementation candidate | Точный набор ревизий и собранных артефактов, переданный на ИФТ как единое целое. |
| Archive | Операция OpenSpec, применяющая Delta Specs к Master Specs до передачи Jira Story на UAT. |
