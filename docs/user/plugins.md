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

### Один процесс работы

Change Tracking связывает Change, точный task ID и Code Repository с реализацией
в Git. Ни аккаунт Git-хостинга, ни дополнительный MCP не нужны. Plugin требует
OpenSpec `>=1.11.0 <2`; галочки, тесты и приёмка остаются в OpenSpec/Verify.

Из Code Repository:

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry
openspec-orch plugin exec --repo specs change-tracking start payment-retry 4
# Реализация, проверки и обычный commit.
# После стандартной отметки задачи в OpenSpec:
openspec-orch plugin exec --repo specs change-tracking complete payment-retry 4
```

Берите ID из `artifact_instructions.tasks[].id`, а не номер внутри описания.
Обычный вызов требует только Change и task: Plugin сам получает Repository,
planning/base/implementation revisions и проверяет Git. Один commit может закрывать
несколько задач; для задачи без изменения кода пустой commit не нужен.

`start` требует открытый task, чистый Code checkout и зафиксированные входы Apply.
Изменения галочек и других Changes не требуют отдельного Store commit перед каждой
задачей. `checkpoint` и `complete` требуют чистый Code checkout, продолжение истории
от начала работы и неизменный план. `complete` дополнительно требует выполненную
галочку, но не ставит её и не утверждает, что проверки прошли.

### Передача частичной реализации

```bash
openspec-orch plugin exec --repo specs change-tracking checkpoint payment-retry 4 \
  --note "Осталось проверить отображение ошибки в UI"
```

Checkpoint обновляет `openspec/changes/<change-id>/implementation-map.yaml`,
не закрывая задачу. Необязательная заметка объясняет следующий шаг, но не заменяет
Tasks или Verify. Чтобы передать работу:

1. Опубликуйте Code commit и Store map обычным Git-процессом команды.
2. В другой рабочей копии получите оба репозитория и подготовьте точный сохранённый
   Code commit. Plugin не выполняет fetch или checkout.
3. Вызовите тот же `start <change-id> <task-id>`: он восстановит начало работы
   из карты без доступа к локальному состоянию прежнего исполнителя.
4. Продолжите работу и сохраните следующий checkpoint либо complete.

В карте одна текущая запись на Repository/task; история доступна через Git Store.
Незакоммиченные изменения другой агент получить не сможет. Если сохранённого Code
commit нет локально, Tracking остановится с понятной ошибкой, а не подставит HEAD.

### Конфликты и повторные вызовы

Повторное сохранение того же результата безопасно, в том числе после прерывания
между записью карты и обновлением локального состояния. Конкурентная запись другой
задачи сохраняется; устаревшая запись той же задачи отклоняется. Перечитайте карту
и согласуйте продолжение, не повторяйте запись вслепую.

OpenSpec ID могут быть позиционными. Поэтому Plugin сравнивает все входы Apply,
включая многострочные описания, а не только ID или первую строку задачи. Изменение
плана делает прежнее соответствие `stale`; смена галочки — нет. После проверки
нового scope можно явно начать заново через `start ... --restart`. Это также
явное подтверждение новой истории после её переписывания. Автоматического переноса
evidence на перенумерованную задачу нет.

```bash
openspec-orch plugin exec --repo specs change-tracking cancel payment-retry 4 "Передано коллеге"
```

Cancel удаляет только локальную запись этого checkout. Опубликованный checkpoint,
галочки и Git не меняются. Причина обязательна и возвращается вызывающему; журнал
локальных отмен в Store не ведётся. Повреждённый файл сохраняется для диагностики,
неизвестные форматы не мигрируют и не сбрасываются автоматически.

### Статус и Verify

Чтобы увидеть все активные Changes выбранного Store, включая ещё не начатые в
Tracking, используйте `status --all`:

```bash
openspec-orch plugin exec --repo specs change-tracking status --all
```

Один Change — одна строка: прогресс OpenSpec, записанные итоги, количество
промежуточных записей Repository/task и замечаний. Подробности раскрываются обычным
`status <change-id>`. Список берётся из `openspec list --json`, архив не включается.
Повреждённая карта одного Change не скрывает остальные; ошибка самого списка
останавливает запрос, а не выдаёт пустой обзор. Для агента тот же режим доступен
через `tracking_status` с `all: true` вместо `change_id`.

Обычный `status` показывает краткую сводку: сколько задач отмечено в OpenSpec,
для скольких записан итог реализации и что требует внимания. Затем — задачи,
репозитории и понятное объяснение состояния, без SHA и журналов. У замечания есть
следующий шаг. Например, выполненная галочка без итоговой записи не выглядит как
завершённый Tracking. `complete` в карте не равно успешному Verify.

Для продолжения конкретной задачи раскройте её по точному ID:

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4
```

Ответ добавит следующий шаг, необязательную заметку исполнителя, путь к заданию
и входам Apply в Store. Если задача связана с вызывающим Code Repository, будет
показан путь именно этой рабочей копии, в том числе Git worktree.

Агент получает такую же краткую информацию через `tracking_status`; необязательный
`task_id` раскрывает задачу. После start/checkpoint/complete/cancel Plugin возвращает
понятный результат действия и следующий шаг. Вручную запускать CLI пользователю
для этого не нужно: инструменты вызывает агент по инструкции Extension.

Сводка вычисляется заново из OpenSpec Apply JSON, локального Git и существующей
карты/локального состояния Tracking. Описания и галочки не дублируются в карте.
Счётчик итогов учитывает каждую задачу один раз и требует complete во всех её
известных записях; он не доказывает полноту охвата репозиториев. Заметка — текст
исполнителя, а не подтверждение выполненной проверки.

Если OpenSpec недоступен, прогресс неизвестен, а не равен нулю. Изменившийся план
делает прежние связи устаревшими. `ahead` означает более поздние коммиты, само по
себе это не ошибка. Локальное начало работы не означает, что агент сейчас активен.

Чтобы посмотреть изменения после последней сохранённой точки конкретной задачи:

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4 --diff
```

Ответ отдельно показывает число новых коммитов, итоговый список изменившихся
в них файлов и незакоммиченные файлы (включая новые). Это сравнение всего
Repository, а не доказательство принадлежности файлов выбранной задаче. База —
последняя запись checkpoint или complete; после нового сохранения она меняется.
Без сохранённой точки сравнение недоступно — начальный commit не подставляется.
Флаг `--diff` требует `--task` и несовместим с `--all`; в MCP ему соответствует
`diff: true` вместе с `change_id` и `task_id`. Если запись задачи есть в нескольких
репозиториях, каждый сравнивается отдельно. Git ничего не переключает и не сохраняет.

Для технических данных есть `status <change-id> --json` и
`tracking_status` с `details: true`, в том числе для подготовки сохранённого commit
при передаче работы.
Ответ включает текущий `candidate` только для репозиториев, известных Tracking;
полноту scope нужно сверить с Change.

Если Code checkout изменился, проверки относятся к новому кандидату. Состояния
`dirty`, `missing_commit`, `diverged` и `unavailable` требуют выяснить причину;
не называйте результат подтверждением сохранённой реализации.

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
assignment scope и doctor, controlled setup tools `initialize_project` и
`connect_project`. Graph и Tracking добавляют собственные tools при подключении.
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
