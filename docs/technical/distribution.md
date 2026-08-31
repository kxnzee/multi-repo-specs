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
| Project schemas | validation; новый ID для несовместимого DAG |
| Bundled Plugins | обновляются вместе с distribution |
| External Plugin | отдельное exact source update |
| Agent payload | machine-local remove/setup/status |
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

Несовместимый schema DAG получает новый schema ID, чтобы существующие Changes
завершили старый процесс.

## Release gate

```bash
npm run check
npm pack --dry-run
git diff --check
```

Новый supported baseline требует isolated smoke с заявленной версией OpenSpec и
каждым поддерживаемым Agent provider.
