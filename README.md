# OpenSpec Orchestrator

OpenSpec Orchestrator — локальный CLI для создания центрального OpenSpec Store,
подключения Code Repositories и установки расширений для Claude, Qwen и GigaCode.

Orchestrator отвечает за окружение и интеграции. Требования, Changes, schemas и
artifact lifecycle остаются в OpenSpec. Реализация, CI, deployment, Release и
Archive остаются процессом команды.

## Требования

- Node.js 22.16.0 или новее;
- npm и Git;
- OpenSpec CLI в `PATH`.

Change Tracking дополнительно требует OpenSpec `>=1.11.0 <2`.

## Разработка и работа агента

Для изменения этого репозитория достаточно Node.js и Git. Из чистого checkout:

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git
cd multi-repo-specs
npm ci
npm run check:environment
npm run check
```

OpenSpec 1.11.0 устанавливается локально как dev dependency. Глобальный OpenSpec,
`npm link` и вход в Agent providers для разработки не нужны. `.nvmrc` фиксирует
Node 22.16.0 — минимальную версию из CI. Для полной проверки поставки выполните
`npm run check:all`.

Агент начинает с [AGENTS.md](AGENTS.md); команды для одного теста, карта кода и
диагностика описаны в [руководстве разработчика](docs/technical/development.md).
Инструкции в `templates/` и `extensions/` являются поставляемыми assets для
пользовательских проектов.

## Установка для пилота

```bash
git clone https://github.com/kxnzee/multi-repo-specs.git /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm install --global @fission-ai/openspec@1.11.0
npm link
openspec-orch --help
```

Пилот использует Git tag или commit как идентификатор версии. Обновление, восстановление после прерывания и миграция
Store описаны в [руководстве по установке и обновлению](docs/user/installation-and-updates.md).

Версия формата `openspec-orch.yaml` не изменяется без явной инструкции владельца
Store. В частности, обновление Orchestrator не является разрешением повышать поле
`version` или автоматически мигрировать конфигурацию: при несовместимости нужно
остановиться и отдельно согласовать целевую версию и миграцию.

## Быстрый старт

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main

cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch doctor
```

Если Store использует внешние Plugins или Extensions, после checkout восстановите
их строго из committed lockfile:

```bash
openspec-orch package sync
```

Template `default` автоматически добавляет Extensions `spec-driven-extended` и
`superpowers` и устанавливает две project-local schemas:

- `spec-driven-extended` — короткий процесс с Intake и Verify;
- `superspec-multirepo` — полный процесс Brainstorm → Verify.

Schema выбирается для каждого Change отдельно:

```bash
openspec new change update-copy --schema spec-driven-extended
openspec new change redesign-checkout --schema superspec-multirepo
```

## Agent gateway

Для доступа Agent к governed MCP один раз установите gateway и перезапустите Agent:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Gateway удаляется командой `openspec-orch agent remove --agent qwen`.

## Plugins

Plugins не устанавливаются Template и подключаются явно:

| Plugin | Назначение |
|---|---|
| `openspec-graph` | Проверка связей Store, Changes, Specs и Repositories |
| `codegraph` | Локальная навигация по коду выбранного Repository |
| `change-tracking` | Связь OpenSpec tasks с revisions Code Repositories |

Пример:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch plugin exec openspec-graph inspect --json
```

Подробнее: [Plugins](docs/user/plugins.md).

Standalone Extension из npm добавляется отдельно:

```bash
openspec-orch extension init <extension-id> --from <package@version>
openspec-orch extension connect <extension-id>
openspec-orch extension status <extension-id>
```

Версии внешних пакетов хранятся в `.openspec-orch/packages/package.json` и
`package-lock.json`; `openspec-orch.yaml` хранит только их стабильные ID.

## Документация

- [полная карта документации](docs/README.md);
- [установка, обновление и rollback](docs/user/installation-and-updates.md);
- [создание проекта и onboarding существующего Store](docs/user/getting-started.md);
- [конфигурация](docs/user/configuration.md) и [Project Template](docs/user/project-template.md);
- [Plugins: эксплуатация, отключение и удаление](docs/user/plugins.md);
- [единый процесс работы над Jira Story](docs/user/story-delivery-process.md);
- [архитектура](docs/technical/architecture.md), [CLI/MCP reference](docs/technical/reference.md)
  и [модель данных](docs/technical/data-model.md);
- [разработка Plugin](docs/technical/plugin-platform.md) и
  [разработка Orchestrator](docs/technical/development.md).

Термины Store, Code Repository, OpenSpec Change и типы процессных PR закреплены в
[глоссарии проекта](CONTEXT.md).

Полная проверка репозитория и устанавливаемых пакетов:

```bash
npm run check:all
git diff --check
```
