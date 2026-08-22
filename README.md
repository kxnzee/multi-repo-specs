# OpenSpec Orchestrator

OpenSpec Orchestrator сохраняет два факта multi-repo Change:

- Cycle — какая версия планирования и какие Code Repositories приняты в работу;
- Snapshot — какой точный набор коммитов был проверен вместе.

## Что это за приложение

OpenSpec Orchestrator — локальный CLI для координации одного изменения сразу в
нескольких репозиториях. Он работает поверх OpenSpec и Git: связывает центральный
Store со спецификациями и Code Repositories, фиксирует принятую версию планирования,
результаты реализации и проверенный набор коммитов.

## Чем оно поможет команде

- все участники работают от одной принятой версии Change и одного списка затронутых
  репозиториев;
- для каждого репозитория сохраняется точный коммит результата, поэтому реализацию
  можно однозначно сопоставить с планированием;
- общий Snapshot показывает, какие версии нескольких репозиториев были проверены
  вместе, и снижает риск проверить или выпустить несовместимую комбинацию;
- `status` даёт воспроизводимую картину прогресса и следующего действия после смены
  сессии или перезапуска процесса;
- проверки конфигурации, Git-состояния и OpenSpec Store раньше обнаруживают ошибки
  подключения и рассинхронизацию рабочего окружения.

## Базовый Project Template

Встроенный Template из `templates/base/` задаёт единый стартовый процесс команды и
применяется командой `openspec-orch init`, если не передан собственный `--template`.
Он дополняет официальный agent pack OpenSpec проектными файлами:

- инструкциями и нативными mapping для Qwen, GigaCode и Claude;
- правилами подготовки и проверки Proposal, Delta Specs, Design и Tasks;
- единым meta-skill `openspec-base-meta-planning`, тремя leaf-skills для Intent,
  Apply-контекста и тест-кейсов, тремя ограниченными read-only subagents и project
  command `/openspec-base-context`;
- структурой долговечного контекста проекта: продукт, доменная модель, архитектура,
  безопасность, quality gates и release process;
- командой обновления проектного контекста без переноса прикладного кода в Store.

Это даёт команде одинаковые правила планирования и реализации во всех новых Store,
оставляя их обычными версионируемыми Markdown/YAML-файлами. Template используется
только во время `init`: после установки Core не зависит от его исходного каталога и
не изменяет встроенные команды или skills OpenSpec. Заготовки контекста нужно
заполнить фактами конкретного проекта до использования в рабочем Change.

Только meta-skill оркестрирует Planning subagents; остальные skills и все subagents
являются leaf-артефактами. Команда контекста может вызвать только context researcher
и repository evidence scout. Repository-specific исследование выполняется отдельно
для каждого точного `repository-id`, разрешённого checkout и проверенной полной Git
revision с чистым working tree; агент не ищет репозитории за пределами переданного
workspace. Направленные зависимости систем хранятся в `system-map.yaml` версии 2 как
типизированные `source → relation → target`, а новые Scenario ID имеют формат
`<change-id>-<index>`.

Текущая версия рассчитана на одного инженера, одну машину, один Store и локальные checkout
Code Repositories. Она не планирует Change, не запускает агента или тесты, не делает
checkout и не выполняет `git add`, `commit`, `push`, `merge` или `rebase`.

Документация:

- [пользователям](docs/user/README.md) — что читать и как пройти командный процесс;
- [разработчикам Orchestrator](docs/technical/README.md) — контракт и устройство текущей версии;
- [оригинальная документация OpenSpec](docs/openspec-origin-docs/README.md) — справочник
  upstream-продукта, не инструкция этого проекта;
- [архив](docs/archive/README.md) — предыдущие модели и неактуальные материалы.

Нормативный [продуктовый контракт](docs/technical/product-contract.md) находится в
технической документации. Кандидаты развития после пилота
собраны в [BACKLOG.md](BACKLOG.md).

## Требования и локальная установка

- Node.js `20.19.0+`;
- npm (для установки dependencies пользовательских Plugin Packages);
- Git;
- OpenSpec CLI `1.7.0` для `init` и `connect`.

Пакеты стандартной поставки устанавливаются как dependencies Orchestrator и владеют
собственными runtime dependencies. Их исходники и документация находятся в
каталоге [`plugins/`](plugins/).

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

## Публичный CLI

```text
openspec-orch init [path] --store <id> --agent <id> [--template <path>] [--repo <id=remote#branch>]...
openspec-orch connect [--workspace <path>]
openspec-orch plugin init [--plugin <plugin-id>]... [--from <path>]...
openspec-orch plugin connect <plugin-id> [--repo <repository-id>]...
openspec-orch plugin status [--plugin <plugin-id>] [--repo <repository-id>] [--json]
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch <plugin-id> --repository <repository-id> <native-args...>
openspec-orch repository status [--repo <repository-id>]...
openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id>
openspec-orch record assignment <change-id> --repo <repository-id> --commit <sha> --status <completed|failed|blocked> --source <human|agent|ci> [--note <text>]
openspec-orch verify <change-id>
openspec-orch record verification <change-id> --result <pass|fail> --source <human|agent|ci> [--note <text>]
```

`init` использует `--agent` и необязательный `--template` только для начальной
установки проектных файлов. Core не хранит agent mapping или handoff в
`openspec-orch.yaml` и не использует их после `init`.
Поддерживаемые значения `--agent` и их нативные пути перечислены в едином
[справочнике агентов](docs/user/supported-agents.md).

Команды `assign`, `record assignment` и `record verification` сначала показывают
preview и требуют интерактивного подтверждения. Отказ пользователя ничего не
записывает. JSON-вывод и неинтерактивные confirmation token в текущую версию не входят.

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
version: 2
strict: true
plugins: []

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins: []
  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
    plugins: []
  - id: backend
    roles: [code]
    remote: ssh://git.example.org/product/backend.git
    default_branch: main
    plugins: []
```

Точный формат описан в [справочнике `openspec-orch.yaml`](docs/user/configuration.md).
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
[Pilot Runbook](docs/user/pilot-runbook.md).

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

Разработка и устройство Core описаны отдельно в
[технической документации](docs/technical/development.md).
