# Change Tracking

Change Tracking связывает OpenSpec Change, точный task ID и Code Repository с
реализацией в Git. Плагин не создаёт ветки или PR, не обращается к Git hosting и
не выполняет и не блокирует шаги OpenSpec. Для пользовательского статуса он
читает task progress через публичный JSON API OpenSpec, но не меняет его.

## Подключение

```bash
openspec-orch agent setup --agent qwen
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

Binding к Store нужен Store-scoped командам, bindings к Code Repositories доставляют
Agent-инструкцию самого плагина. После подключения перезапустите Agent.

## Один процесс работы

Из Code Repository:

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry
openspec-orch plugin exec --repo specs change-tracking start payment-retry 4
# Работа в Code Repository и обычный commit.
openspec-orch plugin exec --repo specs change-tracking complete payment-retry 4
```

Пользователь или агент передаёт только Change и точный task ID из своего рабочего
контекста. Плагин трактует task ID как непрозрачный ключ и сам определяет Repository,
Store/base/implementation revisions и состояние Git checkout.

`start` требует существующий активный Change и чистый Code checkout. `checkpoint`
и `complete` требуют committed состояние и продолжение истории. Операции записи
не читают галочки Tasks, не зависят от них и не меняют OpenSpec.

## Передача частичной реализации

```bash
openspec-orch plugin exec --repo specs change-tracking checkpoint payment-retry 4 \
  --note "Осталось проверить отображение ошибки в UI"
```

Checkpoint обновляет `openspec/changes/<change-id>/implementation-map.yaml`. Для
передачи работы опубликуйте Code commit и Store map обычным
Git-процессом команды. В другой рабочей копии получите оба репозитория, подготовьте
сохранённый commit и вызовите тот же `start`.

В карте хранится одна записанная точка на Repository/task; история доступна через
Git Store. Отдельное состояние готовности в карте не хранится: его источником
остаётся checkbox OpenSpec. Незакоммиченные изменения не передаются. Если
сохранённый Code commit недоступен локально, плагин останавливается с ошибкой и
не подставляет текущий HEAD.

Повторное сохранение того же результата безопасно. Конкурентная запись другого task ID
сохраняется, а устаревшая запись того же task ID отклоняется. Для явного начала новой
локальной работы можно вызвать `start ... --restart`. Если прежняя
`base_revision` доступна и остаётся предком текущего HEAD, restart сохраняет её как
точку сравнения; расходящаяся история отклоняется.

```bash
openspec-orch plugin exec --repo specs change-tracking cancel payment-retry 4 "Передано коллеге"
```

`cancel` удаляет только локальную запись checkout. Опубликованный checkpoint и Git
не меняются.

## Статус

```bash
openspec-orch plugin exec --repo specs change-tracking status --all
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4 --diff
```

`status --all` использует список активных Changes и task progress из публичного
JSON API OpenSpec. Обычный `status` показывает checkbox каждой задачи рядом с
наличием revision и состоянием checkout. Фокус на task ID работает и для задачи,
у которой revision ещё не записана.

`--diff` показывает коммиты и файлы после последней сохранённой точки выбранной
задачи, а также незакоммиченные файлы. Это сравнение всего Repository, а не
доказательство принадлежности каждого файла задаче. Git ничего не переключает и
не сохраняет.

Технические revisions доступны в JSON/details-режиме. Обычный статус их не
показывает. Если OpenSpec API временно недоступен, revisions остаются читаемыми,
а task progress помечается как неизвестный. Если Git недоступен, состояние checkout
также остаётся неизвестным, а не превращается в успешный результат.

Агент получает те же операции через MCP-инструменты `tracking_start`,
`tracking_checkpoint`, `tracking_complete`, `tracking_cancel` и `tracking_status`.
Пользователю не требуется вручную вызывать CLI, если подключённая Agent Extension
может вызвать инструменты по явному рабочему контексту. Это не меняет поведение
шагов OpenSpec при установленном или отсутствующем плагине.

Диагностика и отключение описаны в [общем lifecycle](operations.md). Реализация
находится в `plugins/change-tracking/`.
