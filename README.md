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

## Установка для пилота

```bash
git clone <orchestrator-repository> /absolute/path/to/openspec-orchestrator
cd /absolute/path/to/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm link
openspec-orch --help
```

Пилот использует Git tag или commit как идентификатор версии. Обновление и миграция
Store описаны в [руководстве по установке и обновлению](docs/user/installation-and-updates.md).

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
openspec-orch repository status
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

## Документация

- [полная карта документации](docs/README.md);
- [установка, обновление и rollback](docs/user/installation-and-updates.md);
- [создание проекта и onboarding существующего Store](docs/user/getting-started.md);
- [конфигурация](docs/user/configuration.md) и [Project Template](docs/user/project-template.md);
- [Plugins: эксплуатация, отключение и удаление](docs/user/plugins.md);
- [личный](docs/user/solo-flow.md) и [командный](docs/user/team-flow.md) Change flow;
- [архитектура](docs/technical/architecture.md), [CLI/MCP reference](docs/technical/reference.md)
  и [модель данных](docs/technical/data-model.md);
- [разработка Plugin](docs/technical/plugin-platform.md) и
  [разработка Orchestrator](docs/technical/development.md).

Полная проверка репозитория:

```bash
npm run check
git diff --check
```
