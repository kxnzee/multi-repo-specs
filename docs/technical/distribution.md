# Поставка и совместимость

Пользовательская процедура находится в
[руководстве по обновлению](../user/installation-and-updates.md).

## Единица поставки

Root package `openspec-orchestrator` содержит CLI entrypoints, Agent definitions,
bundled Extensions и Templates. Core, MCP и first-party Plugins входят как точные
внутренние dependencies.

Orchestrator запускается на рабочей машине или в CI и не является runtime dependency
Code Repositories. Принятую версию выбирает центральный Store.

## Каналы

Во время пилота поставка — Git checkout, `npm ci` и `npm link`. Identity версии —
immutable tag и commit.

После пилота root distribution и publishable workspaces публикуются в корпоративный
npm registry. Store хранит exact root dependency и lockfile; пользователь не
подбирает версии внутренних packages отдельно.

## Контракты совместимости

| Contract | Миграция |
|---|---|
| CLI/Core API | release notes; breaking change требует новой major policy |
| `openspec-orch.yaml` | отдельный Store PR |
| Template assets | content-aware Store PR, не повторный `init` |
| Project schemas | validation; прежний ID и DAG сохраняются для активных Changes, новый DAG получает новый ID |
| Bundled Plugins | обновляются вместе с distribution |
| External Plugin | отдельное exact source update |
| Agent gateway | `agent remove/setup/status` на каждой машине |
| Standalone и Plugin-owned Extensions | переустановка native payload и восстановление подключений; [процедура](../user/installation-and-updates.md#machine-local-обновления) |
| Plugin data | migration владельца Plugin |

Неизвестные config и storage versions отклоняются fail-closed.

## Release metadata

Release notes фиксируют tag, commit, package version, supported Node/OpenSpec/Agents,
migration class, изменённые contracts, проверки и rollback. Version identity нельзя
переносить на другое содержимое.

## Migration boundary

`init` создаёт Store и один раз применяет Template; migration engine отсутствует.
Portable migration выполняется в ветке Store и проходит review. Machine-local
migration выполняется после merge на каждой машине. Code Repositories меняются только
по отдельному принятому Change.

Пока у schema есть активные Changes, сохраняйте её прежний ID и граф зависимостей
артефактов (DAG). Новый DAG установите под новым ID и выбирайте только для новых
Changes. Старую schema можно удалить отдельным Store PR после завершения и Archive
всех связанных Changes.

## Release gate

```bash
npm run check:all
git diff --check
```

`check:all` включает `test:pack`: установку tarballs в чистый consumer и проверки
public CLI/MCP. Для отдельной проверки состава root tarball доступен
`npm pack --dry-run`; он не заменяет проверку установки и работы пакетов.

Новый supported baseline требует isolated smoke с заявленной версией OpenSpec и
каждым поддерживаемым Agent provider.
