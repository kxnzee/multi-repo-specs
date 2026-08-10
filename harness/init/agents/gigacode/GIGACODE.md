# Инструкции для GigaCode

- Первое сообщение в каждом новом диалоге всегда начинай на русском языке.
- Всегда общайся с пользователем, задавай вопросы и формируй отчёты на русском языке.
- Не переходи на английский язык из-за англоязычных исходников, документации или вывода инструментов.
- Не переводи код, команды, пути, идентификаторы, имена полей и обязательные машинные значения.
- Если нужно привести английский фрагмент, поясни его пользователю на русском языке.

## Завершение Planning

<!--
Этот раздел намеренно находится в файле инструкций агента, а не в `openspec/config.yaml`.
GigaCode загружает этот файл при старте сессии, тогда как built-in `/opsx-continue`
в ветке `isComplete: true` завершает работу до вызова `openspec instructions` и не получает
из конфигурации правила для финального ответа. Правила содержимого Proposal, Specs, Design
и Tasks остаются в `openspec/config.yaml`, потому что OpenSpec передаёт их агенту через
`openspec instructions` при создании каждого ready-артефакта.
-->

- В этом проекте `isComplete: true` после `/opsx-continue` означает только завершение Proposal, Specs, Design и Tasks, а не готовность реализации.
- После завершения всех planning-артефактов сообщи, что следующий этап — шаг 04, Planning PR и фиксация Spec Baseline.
- Не предлагай и не запускай `/opsx-apply`, пока Planning PR не принят и Spec Baseline не зафиксирован.
- Не предлагай и не запускай `/opsx-archive` до шага 09 и результата `archive_readiness: ready`; к этому моменту должны быть завершены backend, frontend, Composite Verification и ручная проверка.
- Универсальную подсказку built-in `/opsx-continue` о немедленном Apply или Archive замени маршрутом на шаг 04.

## Planning PR

- Шаг 04 выполняется штатными командами OpenSpec, Git и интерфейсом Git-провайдера. Не предлагай отдельные `sdd review`, `sdd baseline`, собственный state-файл или Git tag.
- Не считай HEAD ветки `feature/<change-id>` Spec Baseline. Baseline появляется только после merge Planning PR и равен полной принятой Git SHA основной ветки Store.
- Если Change Owner передал замечания Planning PR через `/opsx-update <change-id>`, изменяй только уже существующие planning-артефакты текущего Change и только в границах переданных unresolved comments. Не создавай код, новый Change, Apply или Archive.
- Если интерфейс Git-провайдера недоступен, потребуй точный текст замечаний и ссылки на threads либо `file:line`; не восстанавливай замечания по пересказу или догадке.
- Перед записью покажи предложенные изменения по артефактам и получи подтверждение Change Owner. Не закрывай review threads, не создавай commit, не выполняй push и не подтверждай PR от имени владельцев.
- После принятия Planning PR напомни Change Owner создать в исходной Story по одной implementation subtask на каждый окончательно затронутый repository-id. Передавай в неё только parent_ticket, change_id, store_id, spec_baseline, planning_pr, repository_id и work_packages с точными task.id из структурированного `openspec instructions apply --change <change-id> --json` на принятом Baseline; не копируй текст спецификации или локальный implementation plan и не извлекай ID из описаний Tasks.
- Отдельная QA-subtask остаётся открытым решением: не создавай и не требуй её как гейт до принятия отдельного правила.

## Начало реализации

- До реализации Apply Owner запускает `sdd load --store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>...` из корня своего Code Repository, передавая значения актуальной implementation subtask.
- После `implementation_ready` новая агентская сессия из Code Repository получает точный `next_action` из результата `sdd load`: готовое первое сообщение указывает на `sdd-apply.md` внутри runtime Store и передаёт те же `--store`, `--repo`, `--change`, `--baseline` и `--work-package`. Не требуй обнаружения slash-команды в Code Repository; runtime подтверждает значения и задаёт границы доступа.
- Не запускай Apply сразу после Planning и не предлагай `sdd load` повторно, если runtime исправен. При повторном load всегда передавай текущие параметры implementation subtask; не пытайся выводить их из Git-ветки или прежнего runtime.
- На шаге 06 выполняй точную runtime-инструкцию `sdd-apply.md`, а не built-in `/opsx-apply`: изменяй только текущий Code Repository, не отмечай центральный `tasks.md` и не переходи к Archive. Commit, push, PR и tracker изменяй только по отдельному явному поручению пользователя.
