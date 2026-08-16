# OpenSpec Orchestrator Alpha

OpenSpec Orchestrator Alpha сохраняет два факта multi-repo Change:

- Cycle — какая версия планирования и какие Code Repositories приняты в работу;
- Snapshot — какой точный набор коммитов был проверен вместе.

Alpha рассчитана на одного инженера, одну машину, один Store и локальные checkout
Code Repositories. Она не планирует Change, не запускает агента или тесты, не делает
checkout и не выполняет `git add`, `commit`, `push`, `merge` или `rebase`.

Нормативные документы:

- [Alpha Concept](docs/OpenSpec-Orchestrator-Alpha-Concept.md) — цель и границы;
- [Alpha Implementation Plan](docs/OpenSpec-Orchestrator-Alpha-Implementation-Plan.md) — технический контракт;
- [Alpha Pilot Runbook](docs/OpenSpec-Orchestrator-Alpha-Pilot-Runbook.md) — запуск пилота;
- [архив](docs/archive/README.md) — предыдущая полная модель, неактуальная для Alpha.

## Требования и локальная установка

- Node.js `20.5+`;
- Git;
- совместимый OpenSpec CLI для `init` и `connect`.

Из корня этого репозитория:

```bash
npm install
npm run check
npm link
openspec-orch --help
```

После смены активной версии Node.js через NVM выполните `npm link` повторно. Без
регистрации в `PATH` CLI можно запустить как
`node /absolute/path/to/multi-repo-specs/src/bin/openspec-orch.js`.

## Публичный CLI Alpha

```text
openspec-orch init [path] --store <id> --agent <id> [--template <path>] [--repo <id=remote#branch>]...
openspec-orch connect [--workspace <path>]
openspec-orch repository status [--repo <repository-id>]...
openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id>
openspec-orch record assignment <change-id> --repo <repository-id> --commit <sha> --status <completed|failed|blocked> --source <human|agent|ci> [--note <text>]
openspec-orch verify <change-id>
openspec-orch record verification <change-id> --result <pass|fail> --source <human|agent|ci> [--note <text>]
```

`init` использует `--agent` и необязательный `--template` только для начальной
установки проектных файлов. Alpha Core не хранит agent mapping или handoff в
`openspec-orch.yaml` и не использует их после `init`.

Команды `assign`, `record assignment` и `record verification` сначала показывают
preview и требуют интерактивного подтверждения. Отказ пользователя ничего не
записывает. JSON-вывод и неинтерактивные confirmation token в Alpha не входят.

Коды завершения: `0` — успех или отказ от preview, `1` — ошибка проверки или
выполнения, `2` — неверный вызов CLI.

## Workspace и конфигурация

Стандартная раскладка:

```text
<workspace>/
├── <store-id>/
│   ├── openspec-orch.yaml
│   ├── openspec/
│   └── .openspec-orch/
└── src/
    ├── frontend/
    └── backend/
```

Минимальная конфигурация пилота:

```yaml
version: 1
strict: true

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
  - id: backend
    roles: [code]
    remote: ssh://git.example.org/product/backend.git
    default_branch: main

extensions: {}
```

Точный формат описан в [справочнике `openspec-orch.yaml`](docs/reference/openspec-orch-yaml.md).
Секреты в URL и поля предыдущего прототипа `role`, `url`, `agent`, `handoffs`
отклоняются строгой схемой.

Для стандартной раскладки выполните из Store:

```bash
openspec-orch connect
openspec-orch repository status
```

Для нестандартной раскладки путь задаётся один раз и сохраняется только локально в
`.openspec-orch/state.json`:

```bash
openspec-orch connect --workspace /absolute/path/to/pilot-workspace
```

`connect` может клонировать отсутствующие Code Repositories, но не обновляет уже
существующие checkout. `repository status` только читает локальное состояние и не
выполняет сетевых или исправляющих операций.

## Минимальный поток одного Change

Подготовьте Change обычным процессом OpenSpec и убедитесь, что Store чист. Затем:

```bash
cd /absolute/path/to/pilot-workspace/specs
openspec-orch assign checkout-flow --repo frontend --repo backend
```

Проверьте preview и подтвердите запись. CLI создаст только Cycle Record. Его нужно
закоммитить обычным процессом команды:

```bash
git status --short
git add .openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json
git commit -m "openspec: assign checkout-flow cycle"
openspec-orch status checkout-flow
```

После появления чистых коммитов реализации запишите Result Receipts. Команду можно
выполнить из Store либо из каталога Code Repository с подключённым OpenSpec pointer:

```bash
FRONTEND_SHA=$(git -C /absolute/path/to/pilot-workspace/src/frontend rev-parse HEAD)
BACKEND_SHA=$(git -C /absolute/path/to/pilot-workspace/src/backend rev-parse HEAD)

openspec-orch record assignment checkout-flow \
  --repo frontend --commit "$FRONTEND_SHA" --status completed --source human
openspec-orch record assignment checkout-flow \
  --repo backend --commit "$BACKEND_SHA" --status completed --source human
```

`record assignment` проверяет текущий закоммиченный Cycle, принадлежность
repository-id и существование commit в локальном checkout. Повторная запись той же
пары заменяет текущий Receipt после предупреждения, сохраняя предыдущий в локальной
истории.

Когда каждый репозиторий имеет текущий `completed` Receipt, вычислите Snapshot:

```bash
openspec-orch verify checkout-flow
```

CLI выведет `snapshot_id` и точные SHA. Он не запускал проверки: выполните их вне
Orchestrator именно на этих версиях, затем зафиксируйте результат:

```bash
openspec-orch record verification checkout-flow --result pass --source human
openspec-orch status checkout-flow
```

Итоговый `status` показывает Cycle, результаты каждого репозитория, текущий
Snapshot, Verification Receipt и следующее действие `готово`. Полный порядок,
отрицательные проверки и восстановление после потери локального state приведены в
[Alpha Pilot Runbook](docs/OpenSpec-Orchestrator-Alpha-Pilot-Runbook.md).

## Хранение данных

| Данные | Расположение | Git |
|---|---|---|
| Config | `openspec-orch.yaml` | да |
| Cycle Records | `.openspec-orch/changes/<base64url-change-id>.json` | да |
| Receipts, Snapshots, workspace | `.openspec-orch/state.json` | нет, mode `0600` |
| Specs и Changes | `openspec/` | да, владелец — OpenSpec |

`state.json` проверяется при каждом чтении и записывается атомарно. Изменяющие его
команды используют локальный межпроцессный lock и безопасно отказывают при
конкурирующей записи. Повреждённый или неподдерживаемый state не перезаписывается
автоматически. Потеря state не уничтожает Cycle: `status` восстановит его из Git и
честно покажет результаты как `missing`.

## Границы кода и разработка

- `src/cli/program.js` — публичная грамматика CLI;
- `src/cli/commands/` — интерактивные пользовательские сценарии и вывод;
- `src/internal/cycle/` — Cycle Record и `status`;
- `src/internal/receipt/`, `snapshot/`, `state/` — локальные результаты и Snapshot;
- `src/internal/init/`, `connect/`, `config/` — bootstrap и реестр репозиториев;
- `src/internal/shared/` — Git, OpenSpec, filesystem и process-примитивы;
- `templates/base/` — Project Template, используемый только при `init`;
- `test/` — unit- и интеграционные проверки на временных Git-репозиториях.

Публичного JavaScript API нет: поддерживаемая поверхность — CLI `openspec-orch`.

```bash
npm run check
git diff --check
node src/bin/openspec-orch.js --help
```
