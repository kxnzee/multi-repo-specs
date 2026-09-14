# Change Tracking

Change Tracking связывает OpenSpec Change, точный task ID и Code Repository с
реализацией в Git. Плагин не создаёт ветки или PR, не обращается к Git hosting и
не выполняет Verify, Archive или Release.

## Подключение

```bash
openspec-orch agent setup --agent qwen
openspec-orch plugin init --plugin change-tracking
openspec-orch plugin connect change-tracking \
  --repo specs --repo frontend --repo backend
```

Binding к Store нужен Store-scoped командам, bindings к Code Repositories —
инструкциям Apply. После подключения перезапустите Agent.

## Один процесс работы

Из Code Repository:

```bash
openspec-orch plugin exec --repo specs change-tracking status payment-retry
openspec-orch plugin exec --repo specs change-tracking start payment-retry 4
# Реализация, проверки и обычный commit.
# После стандартной отметки задачи в OpenSpec:
openspec-orch plugin exec --repo specs change-tracking complete payment-retry 4
```

Берите ID из `artifact_instructions.tasks[].id`, а не номер внутри описания.
Пользователь или агент передаёт только Change и task. Плагин сам определяет
Repository, planning/base/implementation revisions, состояние задачи и Git checkout.

`start` требует открытую задачу, чистый Code checkout и зафиксированные входы Apply.
`checkpoint` и `complete` требуют committed состояние, продолжение истории и
неизменный план. `complete` дополнительно требует установленную галочку задачи,
но сам её не меняет и не утверждает, что проверки успешно пройдены.

## Передача частичной реализации

```bash
openspec-orch plugin exec --repo specs change-tracking checkpoint payment-retry 4 \
  --note "Осталось проверить отображение ошибки в UI"
```

Checkpoint обновляет `openspec/changes/<change-id>/implementation-map.yaml`, не
закрывая задачу. Для передачи работы опубликуйте Code commit и Store map обычным
Git-процессом команды. В другой рабочей копии получите оба репозитория, подготовьте
сохранённый commit и вызовите тот же `start`.

В карте хранится одна текущая запись на Repository/task; история доступна через
Git Store. Незакоммиченные изменения не передаются. Если сохранённый Code commit
недоступен локально, плагин останавливается с ошибкой и не подставляет текущий HEAD.

Повторное сохранение того же результата безопасно. Конкурентная запись другой задачи
сохраняется, а устаревшая запись той же задачи отклоняется. Изменение текста или
состава Apply-задачи делает прежнюю связь `stale`; изменение только checkbox — нет.
После проверки нового scope можно явно вызвать `start ... --restart`.

```bash
openspec-orch plugin exec --repo specs change-tracking cancel payment-retry 4 "Передано коллеге"
```

`cancel` удаляет только локальную запись checkout. Опубликованный checkpoint,
OpenSpec и Git не меняются.

## Статус

```bash
openspec-orch plugin exec --repo specs change-tracking status --all
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4
openspec-orch plugin exec --repo specs change-tracking status payment-retry --task 4 --diff
```

`status --all` показывает активные Changes из OpenSpec. Обычный `status` возвращает
краткую пользовательскую сводку без SHA и журналов: прогресс задач, записанные
результаты и понятные замечания со следующим действием. Фокус на task добавляет
описание, Store paths и состояние текущего checkout.

`--diff` показывает коммиты и файлы после последней сохранённой точки выбранной
задачи, а также незакоммиченные файлы. Это сравнение всего Repository, а не
доказательство принадлежности каждого файла задаче. Git ничего не переключает и
не сохраняет.

Технические revisions доступны в JSON/details-режиме. Если OpenSpec или Git
недоступны, состояние остаётся неизвестным, а не превращается в успешный результат.
`complete` в карте не означает успешный Verify.

Агент получает те же операции через MCP-инструменты `tracking_start`,
`tracking_checkpoint`, `tracking_complete`, `tracking_cancel` и `tracking_status`.
Пользователю не требуется вручную вызывать CLI, если подключённая Agent Extension
ведёт Apply.

Диагностика и отключение описаны в [общем lifecycle](operations.md). Реализация
находится в `plugins/change-tracking/`.
