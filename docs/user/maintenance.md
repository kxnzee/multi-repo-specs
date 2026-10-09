# Сопровождение

Обновление Orchestrator, пакетов и шлюза агента, миграция Store и откат.
Ошибки и восстановление после сбоя — в [диагностике](troubleshooting.md).

## Обновление Orchestrator

Перед обновлением прочитайте описание выпуска: требования к Node.js, OpenSpec и
агентам, изменения формата Store, файлы агента, которые нужно переустановить.

1. Остановите запущенные процессы Orchestrator и MCP.
2. Запишите текущий тег или коммит для отката.
3. Установите новую версию:

   ```bash
   git checkout <approved-tag-or-commit>
   npm ci
   npm link          # только если команда связана глобально
   openspec-orch --version
   ```

4. Если выпуск меняет файлы Store, выполните [миграцию Store](#миграция-store).
5. В каждом Store:

   ```bash
   openspec-orch package status --json
   openspec-orch package sync
   openspec-orch connect
   openspec-orch doctor
   ```

6. Если изменились файлы шлюза, обновите его и откройте новую сессию агента:

   ```bash
   openspec-orch agent setup --agent qwen --refresh
   openspec-orch agent status --agent qwen
   ```

Отдельной команды `upgrade` нет. `connect` восстанавливает версии, зафиксированные
в Store, но не выбирает новые.

## Плагины и расширения

Подключение, обновление, отключение и удаление описаны в
[руководстве по плагинам и расширениям](../plugins/operations.md). Коротко:

```bash
openspec-orch plugin update <plugin-id> --from <exact-source>
openspec-orch extension update <extension-id> --from <exact-source>
openspec-orch connect
openspec-orch doctor
```

- Источник — точная версия npm, архив, коммит Git или локальный путь.
- `package.json` и `package-lock.json` Store проверяются и коммитятся вместе.
- `.openspec-orch/packages` не редактируют вручную и не заменяют символической ссылкой.
- После обновления перезапустите процессы CLI/MCP и откройте новую сессию агента:
  уже запущенный процесс не перечитывает файлы.

Если Extension рассогласована с источником, переподключите её:

```bash
openspec-orch extension connect <extension-id> --refresh
openspec-orch extension status <extension-id>
```

`extension status` проверяет только регистрацию; полную сверку файлов выполняет
`doctor`. Общий кеш агента вручную не удаляйте: им пользуются другие проекты.

## Миграция Store

Миграция нужна, когда выпуск меняет `openspec-orch.yaml`, схемы, файлы Template,
состояние плагинов или обязательный контекст. Повторный `init` Store не обновляет.

1. Создайте отдельное изменение Store по процессу команды.
2. Примените только изменения из описания выпуска.
3. Проверьте:

   ```bash
   openspec schema validate spec-driven-extended
   openspec schema validate superspec-multirepo
   openspec validate --all --strict --no-interactive
   openspec-orch doctor
   git diff --check
   ```

4. После принятия изменения выполните `connect` и `doctor`.

Если в Store свои схемы, проверяйте их идентификаторы. Если новая версия schema
меняет порядок артефактов, а в Store есть активные Changes, сохраните старую
schema под прежним ID, а новую добавьте под новым ID только для новых Changes.

## Откат

```bash
git checkout <previous-tag-or-commit>
npm ci
npm link          # только если команда связана глобально
openspec-orch --version
```

Миграцию Store откатывайте отдельным `git revert` и только если прежняя версия
Orchestrator читает восстановленный формат. Внешние пакеты и файлы агента тоже
должны быть совместимы с выбранной версией.
