# Подключение к существующему проекту

Этот документ для участника команды, у которого Store уже создан. Новый участник
не запускает `init`: Store клонируется и подключается командой `connect`.

Перед началом выполните [установку](installation.md).

## 1. Клонируйте Store

Узнайте у команды Store ID, remote и согласованную ветку. Клонируйте Store в
`<workspace>/<store-id>`:

```bash
git clone <store-remote> /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs
git checkout <approved-branch-or-revision>
openspec store list
```

Если `openspec store list` показывает, что этот Store ID уже указывает на другой
каталог, сначала разберитесь с локальной регистрацией. Не меняйте Store ID в
клонированных файлах.

## 2. Подключите машину

```bash
openspec-orch connect
openspec-orch doctor
```

Если Store лежит не в `<workspace>/<store-id>`, один раз передайте workspace явно:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

После успешного подключения workspace запоминается.

## 3. Проверьте агента и плагины

```bash
openspec-orch agent status --agent qwen
openspec-orch plugin status
```

Если шлюз не установлен, выполните `openspec-orch agent setup --agent qwen`.
Используйте агента, записанного в `openspec-orch.yaml` Store. Затем перезапустите
клиент агента.

Итоговый порядок:

```text
установка → clone Store → connect → doctor → agent status/setup → plugin status → перезапуск агента
```

Дальше: [работа с Change](change/README.md).

## Что делает connect

- Регистрирует Store в OpenSpec на этой машине.
- Клонирует отсутствующие репозитории кода в `<workspace>/src/` и Specs Repositories
  в `<workspace>/linked-specs/`. Существующие каталоги используются как есть: без
  `pull`, без проверки origin, ветки и чистоты.
- Восстанавливает внешние Plugins и Extensions по зафиксированным в Store
  `package.json` и `package-lock.json`. Новые версии не выбирает.
- Доставляет в каждый репозиторий кода команды OpenSpec и навыки выбранного агента,
  подключает Extensions по их целевым ролям.

Созданные в репозиториях файлы отмечаются как `files_changed`; сохраните их по
процессу команды. Повторный `connect` безопасен: совпадающие файлы не считаются
новыми, различия только в LF/CRLF не считаются конфликтом. Если файл OpenSpec в
репозитории отличается от Store по содержимому, `connect` останавливается с
`AGENT_PACK_CONFLICT` и ничего не перезаписывает.

`doctor` ничего не меняет. Он проверяет окружение, конфигурацию, пакеты, шлюз и
доставленные файлы и показывает, что исправить. Коды ошибок разобраны в
[диагностике](troubleshooting.md).

`openspec-orch disconnect` отключает Extensions агента на этой машине, не меняя
конфигурацию Store и не удаляя доставленные файлы.

## Добавить репозиторий в проект

Список репозиториев хранится в `openspec-orch.yaml` Store. Новый репозиторий
добавляется изменением этого файла через ревью Store, после чего все участники
выполняют `connect`.

- Репозиторий кода: запись с `roles: [code]`.
- Store другой команды только для чтения: запись с `roles: [specs]` и `store_id`.
  Все участники должны предварительно обновить Orchestrator до версии с поддержкой
  этой роли.

Формат записей описан в [конфигурации](../core/configuration.md).
