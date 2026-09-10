# Plugins

Plugin расширяет Orchestrator собственными командами, repository lifecycle или
Agent Extension. Template не устанавливает Plugins автоматически, а Core не знает
особенности конкретного Plugin.

Plugin package выполняется как доверенный in-process код. Core проверяет manifest,
package identity и структуру public API, а SDK ограничивает передаваемый context,
файловые пути и параметры процессов, но не является sandbox. Устанавливайте только
проверенные packages из принятого immutable source.

Command contribution становится доступен после `plugin init` и сам по себе не требует
Repository binding. Repository contribution начинает работать после `plugin connect`.
Если этот же Plugin поставляет Agent Extension, она подключается и отключается вместе
с binding конкретного Repository.

## Стандартная поставка

| Plugin | Scope | Назначение |
|---|---|---|
| `openspec-graph` | Store и Specs Repository | Проверяет граф Store, Changes, Specs и Repository Impact |
| `change-tracking` | Store и Code Repository | Связывает OpenSpec tasks с revisions Code Repositories |
| `codegraph` | Store или Code Repository | Управляет локальным CodeGraph index и Agent Extension |

Bundled Plugins поставляются вместе с выбранной версией Orchestrator. `plugin init`
проверяет package и добавляет его стабильный ID в `openspec-orch.yaml`, а
`plugin connect` добавляет binding в запись Repository. Эти изменения относятся к
Store и должны проходить обычные diff, review и commit.

Внешние Plugins и standalone Extensions являются зависимостями одного private
npm-проекта Store. Его `package.json` и `package-lock.json` коммитятся, а
`node_modules` остаётся локальным. На новой машине обычного `connect` достаточно:

```bash
openspec-orch connect
```

Если runtime отсутствует, `connect` сначала выполняет эквивалент `npm ci` строго по
committed lockfile, затем догружает Plugins и восстанавливает Agent Extensions.
Явные `package sync` и read-only `package status [--json]` остаются доступны для
диагностики. Новый внешний Plugin добавляется через `plugin init --from`; его версия
фиксируется npm lockfile, а не Project YAML.

## Standalone Extensions

Встроенный необязательный `spec-reader` создаёт человекочитаемую документацию из
мастер-спек по одной capability или всей системе. Подключение и примеры запросов —
в [руководстве Spec Reader](spec-reader.md).

Standalone Extension управляется адресно через собственную группу CLI:

```bash
openspec-orch extension init <extension-id> --from <package@version>
openspec-orch extension connect <extension-id>
openspec-orch extension update <extension-id> --from <package@version>
openspec-orch extension status <extension-id>
openspec-orch extension disconnect <extension-id>
openspec-orch extension remove <extension-id>
```

Локальный относительный path после `--from` вычисляется от каталога, в котором
запущен `openspec-orch`, одинаково для `extension init` и `extension update`.

`connect` проверяет native Agent CLI и payload перед установкой или включением.
`status` без ID проверяет все объявленные Extensions и поддерживает `--json`.
ID встроенной Extension нельзя затенить внешним package через `--from`.
`disconnect` временно отключает Extension в Agent, не меняя Store. `remove` сначала
удаляет Extension из native Agent и только после успеха удаляет её ID и внешнюю
npm-зависимость из Store. Если локальный `node_modules` отсутствует, `remove` сначала
восстанавливает его из committed lockfile. Если удалить нужно сразу, отдельный
`disconnect` не нужен. Если публикация Store после native removal завершается ошибкой,
Orchestrator откатывает npm state и повторно подключает Extension; ошибка компенсации
возвращается вместе с исходной причиной.
Общий `openspec-orch connect` остаётся способом восстановить все объявленные
Extensions после checkout.

## Общий lifecycle

```bash
cd /absolute/path/to/store
openspec-orch plugin init --plugin <plugin-id>
openspec-orch plugin connect <plugin-id> --repo <repository-id>
openspec-orch plugin update <plugin-id> --from <package@version>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec --repo <repository-id> <plugin-id> <command>
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

`connect`, `status`, `sync` и `disconnect` относятся к repository contribution.
`plugin exec` — единый интерфейс declarative-команд и native argv для всех Plugins;
Plugin-specific root commands отсутствуют. `sync` доступен только Plugin, который
явно объявляет эту операцию.

Без selector `plugin init` показывает каталог в TTY; знак `★` отмечает рекомендуемые
Plugins, но не выбирает их автоматически. В non-TTY передайте `--plugin` или `--all`;
вариант с `--from` принимает ровно один `--plugin` и один source.
ID встроенного Plugin нельзя затенить внешним package через `--from`.
Для `connect`, `sync`, `exec` и `disconnect` при работе с несколькими repositories
повторите `--repo` или используйте `--all`. Единственный candidate выбирается
автоматически. При нескольких без selector TTY показывает выбор, а non-TTY требует
явный selector. В `plugin exec` selector ставится перед Plugin ID, после ID все флаги
принадлежат самому Plugin. `status` не поддерживает `--all`:
без `--repo` он показывает все bindings, а `--repo` ограничивает результат.
`disconnect` удаляет binding и отключает Plugin-owned Extension, но не удаляет
данные Plugin из Repository. `remove` разрешён только без bindings.

`init`, `update`, `connect`, `disconnect` и `remove` могут менять Store package files
или `openspec-orch.yaml`. `update` всегда явный и не выполняется из обычного `connect`.
`status` не меняет declaration или bindings и по контракту диагностирует состояние.
`sync` и `exec` также не меняют declaration или bindings, но могут менять принадлежащее
Plugin состояние согласно его собственному контракту.

## Проверяемое отключение и удаление

Сначала зафиксируйте текущее состояние, затем удалите все bindings и только после этого
declaration Plugin:

```bash
openspec-orch plugin status --plugin <plugin-id> --json
openspec-orch plugin disconnect <plugin-id> --all
openspec-orch plugin status --plugin <plugin-id> --json
git diff -- openspec-orch.yaml
openspec-orch plugin remove <plugin-id>
openspec-orch doctor
git diff -- openspec-orch.yaml
```

Если Plugin поставляет Agent Extension, дополнительно проверьте native состояние:

```bash
# Qwen: Extension должна быть disabled или отсутствовать
qwen extensions list

# GigaCode: Extension должна быть disabled или отсутствовать
gigacode extensions list

# Claude: Plugin не должен оставаться активным в текущем project scope
claude plugin list --json
```

`disconnect` сначала отключает Plugin-owned Extension и затем удаляет portable binding.
Для Qwen/GigaCode payload может остаться установленным, но disabled; Claude adapter
удаляет local Plugin текущего проекта. Общий marketplace удаляется только после
последней регистрации этого Plugin; подключения других проектов сохраняются.
Повторное отключение уже отсутствующей регистрации Claude проходит без ошибки.
`remove` удаляет ID и npm
dependency внешнего Plugin. Ни одна из этих команд не удаляет tracked
repository data, локальный Plugin storage или созданные Plugin данные вроде
`.codegraph/`: их миграция и очистка относятся к контракту конкретного Plugin.

Если отключение завершилось частично, не запускайте `remove`. Сохраните
`doctor --json`, проверьте оставшиеся bindings через `plugin status`, повторите
`disconnect` адресно с `--repo`, затем снова проверьте native состояние. Обычный
`connect` восстанавливает Extensions только для bindings, которые остались в Store.

## OpenSpec Graph

При подключении к основному Store плагин доставляет агенту собственные инструкции:
после подготовки или изменения Proposal/Delta Specs проверять Repository Impact
через Graph и учитывать его диагностику. Это дополнение к текущей schema и штатной
валидации OpenSpec; workflow не зависит от имени плагина. Claude получает инструкции
через SessionStart, Qwen и GigaCode — через context file Extension. Для уже
подключённого плагина после обновления повторите `plugin connect` и начните новую
сессию агента. В подключённые Store с ролью `specs` Extensions не устанавливаются.

Для Store другой команды добавьте подключение с ролью `specs` в
[конфигурацию проекта](configuration.md#подключённые-store-роль-specs), выполните
`connect` и привяжите Graph к локальному имени подключения. Plugin устанавливается
в основном проекте, окружение команды не разворачивается:

```bash
openspec-orch plugin connect openspec-graph --repo payments
openspec-orch plugin exec --repo payments openspec-graph inspect --json
```


```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch plugin exec openspec-graph inspect --json
openspec-orch plugin exec openspec-graph view --port 0
```

Каждый вызов компилирует текущие файлы Store. Graph использует Master/Delta Specs и
строгую таблицу `Repository | Capabilities` из Proposal. Он не читает Code
Repositories и не доказывает ownership, реализацию или runtime dependency.

Архивные изменения и их дельта-спеки отмечены подписью «Архив», серым цветом
и пунктирным контуром; исторические связи сохраняются. Имя изменения на графе,
в деталях и подсказке совпадает с точным `change_id`, включая дефисы и регистр.
Отметка «Архив» вынесена на отдельную строку на графе и в отдельный бейдж в деталях.
В меню «Фильтры» репозитории и мастер-спеки включаются отдельно. Группа «Изменения»
содержит переключатели «Активные», «Архивные» и «Показывать их дельта-спеки».
Дельта-спеки показываются только для выбранных состояний. Если оба состояния
выключены, переключатель дельта-спек недоступен; его выбор сохраняется до повторного
включения изменений или сброса фильтров.
По умолчанию включены только активные изменения; архивные и слой дельта-спек скрыты. «Сбросить»
восстанавливает эти настройки. При открытии и сбросе масштаб подбирается так, чтобы
видимые узлы помещались в полотно с отступом для подписей и легенды.
Фильтры действуют также при поиске и выборе узлов.
После изменения файлов Store, в том числе архивации, перезапустите команду `view`:
открытый viewer показывает снимок на момент запуска, обновления страницы недостаточно.

Viewer получает граф и конфигурацию одним ответом: ошибка загрузки команды остаётся
видимой вместе с неполным графом. Неудавшуюся загрузку можно повторить обновлением
страницы; успешно загруженные Store остаются снимками до перезапуска `view`.

Полный contract: [OpenSpec Graph Plugin](../../plugins/openspec-graph/README.md).

MCP предоставляет `get_spec_graph`, `get_spec_graph_node(node_id)` и
`get_spec_change_impact(change_id)`. Все три читают основной Store; для другого
Store передайте `store_repository_id` из реестра проекта с ролью `store`/`specs`
и подключённым Graph. Кодовый репозиторий в этот аргумент передавать нельзя:
для просмотра его узла используйте `node_id: "repository:<id>"`.
[Контракт MCP и примеры](../technical/reference.md#области-действия-и-идентификаторы)
объясняют источники, ID и замену прежнего `query_graph`.
После обновления перезапустите Agent/MCP, чтобы загрузить новые определения.


Подключённые `specs` сначала показаны свёрнутыми узлами. Клик по узлу раскрывает
внутренние ноды и связи Store на том же графе; повторный клик сворачивает их.
Используется обычная раскладка, без отдельных областей и панелей команд.
Поиск, фильтры и масштаб сохраняются. При перетаскивании Store его внутренние
узлы перемещаются вместе с ним, даже когда свёрнуты: раскрытие происходит на новом
месте. «Сбросить» сворачивает все Store.
Данные команд загружаются при открытии viewer; источники ведут в соответствующий
Store. Вложенные зависимости не разворачиваются.

## Change Tracking

```bash
openspec-orch agent setup --agent qwen
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend

```

Binding к Store нужен Store-scoped командам, bindings к Code Repositories —
инструкциям Apply. После подключения перезапустите Agent.

### Передача частичной реализации

Tracking хранит связи задачи с Code PR в одном файле
`openspec/changes/<change-id>/implementation-map.yaml`. Детальные implementation
tasks остаются в описании PR или закреплённом плане. В карте находятся ссылка на
план, полный список SHA, краткий итог с проверками и оставшаяся работа.

1. Из Code Repository запустите штатный OpenSpec Apply. До продолжения агент читает
   `tracking.implementations` через `get_change_context` или `get_status`, открывает
   связанный PR и план и проверяет оставшиеся шаги.
2. Агент реализует задачу и поддерживает технический план в PR. Для передачи
   незавершённой работы подходит частичный/draft PR; галочка OpenSpec остаётся открытой.
3. При передаче, обновлении PR или завершении агент вызывает `record_implementation`.
   Он передаёт точные `task_id` и `task_description` из Apply-контекста, URL PR/плана,
   явные коммиты, итог и оставшуюся работу. ID из description не заменяет `tasks[].id`.
4. После всех требуемых работ и проверок стандартный Apply ставит галочку. Tracking
   читает её при запросе статуса; сам checkbox не редактирует. `task_state: done`
   означает галочку OpenSpec, а не слияние PR или успешный Verify.
5. Карту и галочки публикуют обычным Store PR. Для частичной передачи ссылка должна
   попасть в доступную получателю ветку Store до завершения работы/слияния Code PR.
   Незакоммиченная локальная карта другим участникам недоступна.

Новый путь не создаёт локальные attempts, не требует чистого Store и промежуточного
коммита перед следующей задачей. Tracking не создаёт PR/коммиты и не обращается к
Git-хостингу: автоматическое обновление выполняет агентский workflow. Если человек
поменял галочку вручную, следующий status покажет её актуальное значение; файл карты
при чтении не переписывается.

Ручной эквивалент из Code Repository (замените ID, описание, URL и SHA своими):

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry
openspec-orch plugin exec --repo specs change-tracking record payment-retry 4 \
  --description "2.3 Обработать ошибки" \
  --pr https://git.example/team/backend/pull/42 \
  --commits <full-sha> \
  --summary "Обработка ошибок реализована, unit-тесты прошли" \
  --remaining "Добавить интеграционные проверки" --version 0
```

`--plan` задаёт ссылку на раздел или комментарий с планом; по умолчанию используется
PR. `--commits` — полный список SHA через запятую; при отсутствии изменений кода
опустите аргумент и объясните это в summary. При завершении передайте `--remaining ""`.
Для обновления используйте `version` существующей связи как `--version`, для новой — 0.
Конфликт версий требует перечитать карту и согласовать изменения, а не повторять
запись вслепую. Разные PR одной задачи сохраняются отдельными связями.

Передавайте SHA именно места реализации, в том числе worktree. Tracking проверяет
существование коммитов в репозитории и не подменяет их основным HEAD. После squash
или rebase обновите список до опубликованных SHA, объяснив замену в PR. Снятая
галочка не удаляет прежнюю связь. Изменённое описание/схема или исчезнувшая задача
дают `changed_or_missing` и `task_done: null`. После согласования соответствия
повторите `record` с актуальными ID/описанием задачи, прежним `--previous-task <id>`
и `--version` исходной связи. PR остаётся тем же. Если изменилось только описание,
укажите тот же ID в `--previous-task`. Операция переносит выбранную связь атомарно;
существующая связь целевой задачи не перезаписывается. Через MCP используется
`previous_task_id`. Не перепривязывайте новую по смыслу задачу без согласования.

`status` возвращает весь список `tasks`, включая задачи без PR, и список
`implementations`. Fragment ссылки PR не входит в его идентичность; ссылку на
комментарий/раздел сохраняйте в `plan_url`. Query URL сохраняется.

Предупреждения не меняют галочки: `DONE_WITH_REMAINING_WORK` — задача закрыта, но
есть оставшаяся работа; `DONE_WITHOUT_IMPLEMENTATION` — закрыта без связи;
`DONE_WITHOUT_COMMITS` — связь есть, коммиты не указаны. Для задач без изменения кода
последнее предупреждение проверяется по пояснению в summary, а не считается отказом.

При повреждении прежнего локального storage карта остаётся доступна вместе с
`legacy_error`. Поля `active` и `cancelled` тогда равны `null` (состояние неизвестно).
Старый файл не удаляется и не переписывается автоматически.

### Локальные attempts

`start_attempt` / `complete_attempt` и CLI `attempt` связывают задачу с диапазоном
ревизий одной локальной рабочей копии. Стандартный Apply использует
`record_implementation`. Результаты attempts находятся в `attempts`, активные
и отменённые попытки — в локальном Plugin storage.

Change Tracking требует OpenSpec `>=1.11.0 <2`. `attempt start` запускается из чистого
Code Repository для незавершённого task. Файлы текущего Change в Store должны быть
закоммичены, чтобы planning revision соответствовала прочитанному плану; изменения
других Changes не мешают запуску. Команда сохраняет base revision только в локальном
Plugin storage. Незавершённая attempt привязана к `checkout_path` и не переносится на другую машину.
Для вложенного или внешнего Git worktree используются его собственные HEAD и status.
Повторный start и первое complete из другой копии возвращают `ATTEMPT_CHECKOUT_CHANGED`;
продолжите в исходной копии либо отмените attempt с причиной.

Если task или schema изменились после старта, `start` и `complete` сообщают
`ATTEMPT_TASK_CHANGED`. Пользователь может отменить старую попытку из Code Repository:

```bash
openspec-orch plugin exec --repo specs change-tracking attempt cancel <change-id> <task-id> "Изменились требования"
```

Причина обязательна. Отмена сохраняет исходную attempt, причину и время в локальном
Plugin storage, освобождает задачу для нового `start` и видна в `tracking.cancelled`
через MCP. Она не меняет checkbox, Git и completed implementation map. Новый MCP
write-метод для отмены не предоставляется. Неизвестный формат локального состояния
отклоняется без автоматического преобразования.
Отмена и завершение одной attempt выполняются под общей локальной блокировкой.

При восстановлении после прерывания `attempt complete` сначала проверяет, сохранён ли
результат этой attempt в implementation map. Если сохранён, команда только очищает
локальную активную запись и возвращает прежний результат, даже если задача уже изменилась.

При первом завершении `attempt complete` повторно читает task через
`openspec instructions apply --json`, требует чистый Code Repository, новый commit
после старта, который продолжает историю base revision, и уже установленную стандартную галочку task, а затем добавляет итоговую
revision в `openspec/changes/<change-id>/implementation-map.yaml`. Она не создаёт
commit и не выполняет `pull` или `push`; файл публикуется обычным Git-процессом Change.
Если task возвращён в работу, его галочка снимается и обычный Apply запускается снова.
Tracker создаёт новую attempt от текущей base revision и добавляет её в историю, не
перезаписывая предыдущую implementation revision.

Plugin не назначает Tasks, не меняет их галочки, не выполняет тесты и не участвует
в Verify, Release или Git-публикации. Сохранённая revision помогает найти реализацию
возвращённого task, но сама по себе не доказывает корректность или приёмку фичи.

## CodeGraph

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin status --plugin codegraph --repo frontend
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin exec --repo frontend codegraph explore "authentication flow"
```

Каждый binding обслуживает только свой checkout и локальный `.codegraph/`. Индекс
не коммитится: при подключении Plugin добавляет `.codegraph/` в локальный
`.git/info/exclude`, не меняя tracked `.gitignore`. Состояние `stale` или `unavailable`
не запускает `sync` автоматически. CodeGraph помогает исследовать текущий код, но не
создаёт Requirements и не расширяет scope Change. Подробности:
[CodeGraph Plugin](../../plugins/codegraph/README.md).

## Orchestrator MCP

Agent gateway устанавливается отдельно от Project и Plugins:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

MCP предоставляет read tools для status, setup context, Change context, next action,
assignment scope, doctor и Graph, controlled setup tools `initialize_project` и
`connect_project` и `record_implementation`; `start_attempt` и `complete_attempt` обслуживают локальные attempts.
Намеренно отсутствуют verification, Release, Archive, arbitrary Git writes, Plugin
lifecycle, Agent management и network transport.

Read-ответ включает `context_revision`. Пока Change, artifact, Repository и их state не
менялись, Agent переиспользует уже полученный Work Context. Когда нужна проверка
свежести, он передаёт revision как `if_context_revision`; неизменившийся ответ занимает
только короткий payload `unchanged`. Для Apply Agent запрашивает
`get_change_context` с `include_assignment: true` и не дублирует его отдельным
`get_assignment_scope`.

Для первого запуска через MCP откройте Agent из корня заранее подготовленного Store,
а не из checkout Orchestrator или Code Repository. Проверьте фиксированный `cwd`
через `get_setup_context`, затем вызовите `initialize_project`. Полный payload,
ограничения каталога запуска и следующий `connect_project` приведены в разделе
[«Альтернатива: инициализация через MCP»](getting-started.md#альтернатива-инициализация-через-mcp).

## Внешний Plugin

`--from` принимает локальный package directory, tarball, Git URL или npm install
spec. Production dependencies устанавливаются без lifecycle scripts, а exact package
identity сохраняется в Store. Сам source должен оставаться доступным команде для
установки runtime на новой машине; локальный cache и credentials в Store не
публикуются.

```bash
openspec-orch plugin init \
  --plugin dependency-audit \
  --from @company/openspec-plugin-dependency-audit@1.2.0
```

Каркас создаётся через `plugin register`:

```bash
# commands-only, binding не нужен
openspec-orch plugin register dependency-audit \
  --profile commands

# repository lifecycle для Code Repositories
openspec-orch plugin register dependency-audit \
  --profile repository \
  --support code \
  --extension
```

Profiles `repository` и `native` создают заготовки lifecycle callbacks, которые нужно
реализовать до `plugin init`; `native` дополнительно поддерживает package-owned argv
runtime. Авторский contract и contract test описаны в
[Plugin SDK](../../packages/plugin-sdk/README.md).

### Запуск из Code Repository

Project-scoped команды `plugin init`, `connect`, `status`, `sync`, `exec`,
`disconnect` и `remove` разрешают Store также через `openspec/config.yaml`
подключённого Code Repository, в том числе из его подкаталогов. OpenSpec должен
разрешать pointer через `openspec context --json`; неразрешённый или несовпадающий
Store останавливает команду до вызова Plugin. `--repo` по-прежнему задаёт целевой
Repository явно и не подменяется текущим каталогом.
