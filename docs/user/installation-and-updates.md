# Установка, обновление и поддержка

## Установка из Git checkout

До публикации в npm registry Orchestrator устанавливается из отдельного Git
checkout. Команда должна заранее согласовать immutable tag или commit.

Если в checkout уже есть committed `package-lock.json`, используйте `npm ci`:
команда установит зависимости точно по lockfile, и предварительный `npm install`
не нужен. Если lockfile отсутствует, выполните `npm install`, проверьте созданный
`package-lock.json` и сохраните его в приватном репозитории вместе с изменением
зависимостей. После этого для повторяемых установок используйте `npm ci`.

```bash
git clone <orchestrator-repository> /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm link
openspec-orch --help
```

После смены активной версии Node.js выполните `npm link` повторно. Без global link
CLI можно запускать через `node /absolute/path/to/repo/bin/openspec-orch.js`.

Центральный Store определяет принятую версию для команды. До появления
machine-readable version pin выбранный tag или commit фиксируется в командной
документации или release notes.

## Обновление Orchestrator

1. Прочитайте release notes: supported Node/OpenSpec/Agents, migration class и
   необходимость обновить Agent payload.
2. Сохраните текущий tag/commit для rollback.
3. Переключите checkout на новую принятую identity.
4. Установите зависимости через `npm ci` при наличии lockfile или через
   `npm install`, если lockfile ещё не создан. Затем выполните `npm run check` и
   `npm link`.
5. В каждом поддерживаемом Store выполните `openspec-orch doctor`.
6. Если portable contracts не менялись, работа завершена.

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

1. Создайте отдельную ветку Store от актуальной default branch.
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
5. Проведите review и merge обычным процессом Store.
6. После merge обновите локальную копию Store и повторите `connect` и `doctor`.

Custom Store проверяет собственные schema IDs. Не заменяйте несовместимый artifact
DAG, пока его используют активные Changes: сначала завершите и архивируйте их либо
сохраните прежнюю schema под отдельным локальным ID. Затем установите новую schema и
создавайте на ней новые Changes.

Если release меняет artifact DAG, не изменяйте под тем же ID schema, которую
используют активные Changes. Установите новую schema под новым ID, сохраните старую
до завершения связанных Changes и переведите на новую schema только новые Changes.
Release notes должны перечислять изменяемые файлы, совместимые schema IDs, порядок
проверки и rollback. Если этих данных нет, миграцию выполнять нельзя.

Code Repositories не меняются только из-за обновления Orchestrator. Для этого нужен
отдельный принятый Change с явным Repository Impact.

## Machine-local обновления

Если изменился Agent gateway или Extension payload, после обновления distribution
переустановите соответствующий payload и проверьте native status:

```bash
openspec-orch agent remove --agent qwen
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Plugin-owned Extensions восстанавливаются через `openspec-orch connect` или
адресный `plugin connect`. Local state и cache не коммитятся в Store.

## Rollback и поддержка

При проблеме верните прежний Orchestrator tag/commit, установите зависимости через
`npm ci` при наличии lockfile или через `npm install` при его отсутствии, затем
выполните `npm link`. Portable Store migration откатывается отдельным Git revert
только если предыдущая версия может читать восстановленный контракт. Не удаляйте
local state до диагностики: сначала сохраните `doctor --json`, версию Node/OpenSpec,
commit Orchestrator и точную команду ошибки.

## Планируемая поставка через npm registry

Root distribution и внутренние packages планируется публиковать в npm registry.
Store получит exact root dependency и lockfile; внутренние версии будут поставляться
как единый согласованный release.
