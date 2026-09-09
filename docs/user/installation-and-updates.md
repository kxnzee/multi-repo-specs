# Установка, обновление и поддержка

## Установка из Git checkout

До публикации в npm registry Orchestrator устанавливается из отдельного Git
checkout. Команда должна заранее согласовать immutable tag или commit.

В репозитории хранится `package-lock.json`: `npm ci` устанавливает зафиксированное
дерево зависимостей, предварительный `npm install` не нужен. Если lockfile отсутствует,
проверьте выбранный commit и полноту checkout. Новый lockfile создаётся при намеренном
изменении зависимостей и проходит review вместе с `package.json`.

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm install --global @fission-ai/openspec@1.11.0
npm link
openspec-orch --help
```

После смены активной версии Node.js выполните `npm link` повторно. Без global link
CLI можно запускать через `node /absolute/path/to/repo/bin/openspec-orch.js`.

Глобальный OpenSpec нужен для команд из реального Store. Для разработки самого
Orchestrator root npm-команды используют локальный OpenSpec из devDependencies;
следуйте [подготовке окружения разработки](../technical/development.md).

Центральный Store определяет принятую версию для команды. До появления
machine-readable version pin выбранный tag или commit фиксируется в командной
документации или release notes.

## Обновление Orchestrator

1. Проверьте в release notes поддерживаемые версии Node/OpenSpec/Agents,
   изменения Store и список Agent payload, которые нужно переустановить.
2. Сохраните текущий tag/commit для отката.
3. Переключите checkout на согласованный tag или commit.
4. Установите зависимости через `npm ci`. Затем выполните `npm run check` и
   `npm link`.
5. Если изменились переносимые файлы или контракты Store, выполните
   [миграцию](#процедура-миграции).
6. Обновите затронутые gateway и Extensions по
   [инструкции ниже](#machine-local-обновления), даже если Store не требует миграции.
7. В каждом поддерживаемом Store выполните `connect` и `doctor`, проверьте native
   payload и перезапустите Agent/MCP. Завершайте обновление после этих проверок.

Отдельной команды `openspec-orch upgrade` нет.

## Когда нужна миграция Store

Миграция требуется, если release меняет хотя бы один portable contract:

- `openspec-orch.yaml`;
- project-local schemas или `openspec/config.yaml`;
- Template assets, которые уже принадлежат Store;
- tracked state Plugin;
- обязательный project context.

Повторный `init` не является миграцией: Template применяется при создании Store и
не перезаписывает отличающиеся файлы.

## Процедура миграции

1. Создайте work branch Store от актуальной Integration branch по проектной Git-политике.
2. Примените только изменения, перечисленные в release notes.
3. Просмотрите diff как обычное изменение Store.
4. Проверьте schemas и все Changes:

   ```bash
   openspec schema validate spec-driven-extended
   openspec schema validate superspec-multirepo
   openspec validate --all --strict --no-interactive
   openspec-orch doctor
   git diff --check
   ```
5. Проведите review и merge через PR в Integration branch Store.
6. После merge обновите локальную копию Store и повторите `connect` и `doctor`.

В Custom Store проверяйте собственные schema IDs. Если меняется граф зависимостей
артефактов (DAG), сохраняйте прежнюю schema под прежним ID для активных Changes.
Новую schema установите под новым ID и выбирайте только для новых Changes.
Переименование старой schema не обновляет ссылки в существующих Changes.
Удаляйте её отдельным Store PR после завершения и Archive всех связанных Changes.

Release notes должны перечислять изменяемые файлы, совместимые schema IDs,
проверки и порядок отката. Если этих данных нет, миграцию выполнять нельзя.

Code Repositories не меняются только из-за обновления Orchestrator. Для этого нужен
отдельный принятый Change с явным Repository Impact.

## Machine-local обновления

Остановите Agent/MCP перед переустановкой. Обновление состоит из двух частей:
восстановления npm packages и обновления файлов, установленных в самом Agent.

### Внешние npm packages

Для внешних Plugins и standalone Extensions `connect` восстанавливает отсутствующий
или устаревший `.openspec-orch/packages/node_modules` из зафиксированных
`package.json` и lockfile. Новые версии выбираются явно через `plugin update` или
`extension update`; изменения manifest и lockfile проходят Store review.

Для отдельного восстановления запустите `openspec-orch package sync`.
Read-only команда `package status --json` проверяет lock, происхождение, имя и версию
установленных packages. Она также сверяет полный lockfile с отметкой последней
успешной установки: новая Git revision или транзитивная зависимость обнаруживается
даже при прежней версии прямой зависимости. При несовпадении или отсутствии отметки
runtime получает `stale`; его восстанавливает `package sync` или следующий `connect`.
Local state и runtime не коммитятся в Store.

### Agent gateway

Команды `agent` управляют только user-level gateway `orchestrator-agent`.
Для обновления до текущей поставки используйте:

```bash
openspec-orch agent setup --agent qwen --refresh
openspec-orch agent status --agent qwen
```

Для Claude замените `qwen` на `claude`, для GigaCode на `gigacode`.
`setup` также обнаруживает устаревшую включённую установку и обновляет её.
`--refresh` явно запускает подключение и проверку, даже если предыдущий status был успешен.
Эти команды управляют только gateway, а не всеми workflow Extensions.

### Workflow и Plugin-owned Extensions

Сначала обновите источник Extension: checkout Orchestrator для bundled payload
или Store package для внешнего. Затем выполните из Store:

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
Не удаляйте целиком `.openspec-orch`: там могут быть активные implementation attempts.

| Симптом | Действие |
|---|---|
| `*_BUSY` после завершения всех процессов | Ошибка показывает точный lock-каталог. Убедитесь, что он обычный и пустой; удалите только его (`rmdir <точный-путь>`), затем повторите операцию. Автоматического снятия старых locks нет. |
| Прерванный npm / отсутствующий или stale runtime | Проверьте committed manifest и lockfile, выполните `openspec-orch package sync`, затем `connect` и `doctor`. |
| Несогласованные `package.json` и `package-lock.json` | Восстановите оба файла из одного принятого Store commit; затем `package sync`. Не генерируйте новый lock ради обхода ошибки. |
| `PLUGIN_LOAD_INVALID` с требованием `restart` | Завершите старый MCP/CLI процесс. После package update/sync запустите новую Agent-сессию: старый ESM module graph нельзя безопасно обновить на месте. |
| Symlink вместо `.openspec-orch/packages` или его родителя | Не запускайте npm по этому пути. Восстановите обычные Store-local каталоги из сохранённой копии и committed файлов; затем `package sync`. |
| Повреждённый state / неизвестная contract version | Сохраните повреждённый файл; восстановите проверенную копию того же контракта. Не меняйте поле версии вручную и не удаляйте данные активных attempts. |
| Частично выполненный первый `init` | Сохраните весь каталог. В новом чистом checkout исходного Store commit повторите `init` с теми же параметрами. Если Store ID занят, согласуйте его локальную регистрацию через OpenSpec. Сверьте результат с сохранёнными файлами; переносите пользовательские данные вручную. Повторный `init` не ремонтирует неполный Store. |

Явный повторный `plugin init --plugin <id> --from <source>` или
`extension init <id> --from <source>` заново разрешает обновляемый пакет внутри
транзакции. Это обновляет содержимое локального source даже без смены его версии.
Manifest и lockfile после такого обновления должны пройти review вместе.
`file:` source остаётся изменяемым: lockfile не заменяет архив исходных локальных
файлов. Для воспроизводимого командного пилота используйте immutable Git SHA или
версионированный registry/tarball с integrity. После изменения внешних пакетов
перезапустите Agent/MCP, включая случаи изменения только транзитивных dependencies.

Если компенсация закончилась ошибкой, остальные независимые компенсации всё равно
выполняются; исходная ошибка и все ошибки отката сохраняются в AggregateError.
Проверьте native Extension status и повторите `connect`. Произвольные side effects
стороннего Plugin требуют восстановления по инструкции этого Plugin.
