# Установка, обновление и восстановление

## Установка

Команда фиксирует версию Orchestrator в release notes или внутренней документации.
До публикации в npm registry используйте согласованный Git tag или commit:

```bash
git clone <orchestrator-repository-url> /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm install --global @fission-ai/openspec@1.11.0
npm link
openspec-orch --help
```

Нужен Node.js 22.16.0 или новее. После смены версии Node.js повторите `npm link`.
Подробности для разработки и диагностики CI находятся в
[техническом руководстве](../core/development.md).

## Обновление Orchestrator

Перед обновлением проверьте release notes: поддерживаемые версии Node, OpenSpec и
Agent, изменения Store и payload, который требуется переустановить.

1. Сохраните текущий tag или commit — он понадобится для отката.
2. Переключите checkout на согласованную версию и выполните `npm ci`.
3. Если release меняет файлы Store, выполните миграцию через отдельный Store PR.
4. В каждом Store запустите `openspec-orch connect` и `openspec-orch doctor`.
5. Обновите gateway или Extensions, если это указано в release notes, и перезапустите Agent.

Отдельной команды `openspec-orch upgrade` нет. Новые версии внешних Plugins и
Extensions выбираются явно через `plugin update` или `extension update`; их manifest
и lockfile проходят обычный review Store.

## Миграция Store

Миграция нужна, когда release меняет переносимый контракт: `openspec-orch.yaml`,
schemas, файлы Template, tracked state Plugin или обязательный project context.
Повторный `init` не обновляет существующий Store.

1. Создайте Store PR по процессу команды.
2. Примените только изменения, перечисленные в release notes.
3. Проверьте schemas, Changes и конфигурацию:

   ```bash
   openspec schema validate spec-driven-extended
   openspec schema validate superspec-multirepo
   openspec validate --all --strict --no-interactive
   openspec-orch doctor
   git diff --check
   ```

4. Проведите review и после merge повторите `connect` и `doctor`.

В Custom Store проверяйте собственные schema IDs. Если меняется порядок артефактов,
сохраните прежнюю schema для активных Changes, а новую заведите под новым ID.

## Gateway и Extensions

Gateway устанавливается на машине пользователя и не входит в Store:

```bash
openspec-orch agent setup --agent qwen --refresh
openspec-orch agent status --agent qwen
```

Замените `qwen` на `claude` или `gigacode` при необходимости. Для workflow Extension
или Plugin-owned Extension запустите из Store `connect` либо адресный `extension connect`
или `plugin connect`, затем проверьте `doctor`. После обновления всегда открывайте
новую сессию Agent и перезапускайте MCP.

## Восстановление после сбоя

Сначала остановите команды и Agent/MCP, использующие Store. Сохраните `doctor --json`,
версию Node/OpenSpec, версию Orchestrator, точную ошибку и Git diff. Не удаляйте всю
`.openspec-orch`: там может быть локальное состояние незавершённой работы.

```bash
openspec-orch extension connect spec-driven-extended
openspec-orch extension status spec-driven-extended
openspec-orch plugin connect change-tracking --repo frontend
openspec-orch doctor
```

Общий `connect` использует те же adapters. Подключение обновляет установленный payload
штатными native-командами и проверяет его файлы. Qwen/GigaCode обновляют существующую
установку по её сохранённому native source; если он отличается от текущей поставки,
успех возможен только при совпадении файлов. Неверный source исправляется отдельно
через native lifecycle, а не скрытой заменой глобальной установки.

### Версии и проверка файлов

При изменении payload издатель повышает `version` в native manifests всех поддерживаемых
провайдеров. Это относится и к инструкциям, skills, commands и hooks: Claude/Qwen могут
не обновить cache при прежнем номере версии. `--refresh` не обходит это правило.

Статус сравнивает shipped files с путём установки из native CLI, включая добавленные,
изменённые и удалённые файлы. Native installation metadata, `.git` и `node_modules`
не сравниваются. При несовпадении возвращается `AGENT_EXTENSION_STATUS_STALE`, а не
`ready`; неизвестный формат native path не принимается за успешную проверку.
Эта проверка общая для gateway, standalone и Plugin-owned Extensions, включая Doctor
и MCP-диагностику. `status` не изменяет установку.

После обновления запустите новую Agent-сессию и перезапустите долгоживущие MCP-процессы.
Совпадение файлов на диске не доказывает, что старая сессия перечитала их.
Не удаляйте общий native cache вручную: он может использоваться другими проектами.

## Rollback и поддержка

При проблеме верните прежний Orchestrator tag/commit, установите зависимости через
`npm ci` по lockfile выбранного commit, затем
выполните `npm link`. Portable Store migration откатывается отдельным Git revert
только если предыдущая версия может читать восстановленный контракт. Не удаляйте
local state до диагностики: сначала сохраните `doctor --json`, версию Node/OpenSpec,
commit Orchestrator и точную команду ошибки.

## Поставка Orchestrator через npm registry

Root distribution и внутренние packages планируется публиковать в npm registry.
Внутренние версии Orchestrator будут поставляться как единый согласованный release.
Это не связано со Store-local npm-проектом внешних Plugins и Extensions.


## Восстановление после прерывания

Перед восстановлением остановите команды и Agent/MCP, использующие этот Store,
сохраните копию Store вместе с `.openspec-orch/`, вывод `doctor --json` и Git diff.
Не удаляйте целиком `.openspec-orch`: там могут быть локальные записи незавершённой работы Tracking.

| Симптом | Действие |
|---|---|
| `*_BUSY` после завершения всех процессов | Ошибка показывает точный lock-каталог. Убедитесь, что он обычный и пустой; удалите только его (`rmdir <точный-путь>`), затем повторите операцию. Автоматического снятия старых locks нет. |
| Прерванный npm / отсутствующий или stale runtime | Проверьте committed manifest и lockfile, выполните `openspec-orch package sync`, затем `connect` и `doctor`. |
| Несогласованные `package.json` и `package-lock.json` | Восстановите оба файла из одного принятого Store commit; затем `package sync`. Не генерируйте новый lock ради обхода ошибки. |
| `PLUGIN_LOAD_INVALID` с требованием `restart` | Завершите старый MCP/CLI процесс. После package update/sync запустите новую Agent-сессию: старый ESM module graph нельзя безопасно обновить на месте. |
| Symlink вместо `.openspec-orch/packages` или его родителя | Не запускайте npm по этому пути. Восстановите обычные Store-local каталоги из сохранённой копии и committed файлов; затем `package sync`. |
| Повреждённый state / неизвестная contract version | Сохраните повреждённый файл; восстановите проверенную копию того же контракта. Не меняйте поле версии вручную и не удаляйте локальные записи незавершённой работы. |
| Частично выполненный первый `init` | Сохраните весь каталог. В новом чистом checkout исходного Store commit повторите `init` с теми же параметрами. Если Store ID занят, согласуйте его локальную регистрацию через OpenSpec. Сверьте результат с сохранёнными файлами; переносите пользовательские данные вручную. Повторный `init` не ремонтирует неполный Store. |
Для отката верните прежний tag или commit Orchestrator, выполните `npm ci` по его
lockfile и повторите `npm link`. Откатывать Store migration можно только если прежняя
версия читает восстановленный контракт.
