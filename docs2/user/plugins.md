# Plugins

Plugin — самостоятельный ESM npm package, который расширяет Orchestrator через
публичный `@openspec-orch/plugin-sdk`. Plugin может добавить repository lifecycle,
CLI grammar, Agent integration и собственный Template, не изменяя Core.

## Plugins стандартной поставки

| Plugin ID | Scope | Обязательность | Назначение |
|---|---|---|---|
| `openspec-graph` | Store | Required в Base Template | Строит производный граф Store/Repositories/Master Specs/Changes/Delta Specs, вычисляет impact и проверяет implementation scope |
| `change-tracking` | Store | Опциональный | Фиксирует Cycle, Results, Snapshot и результат проверки точного multi-repository candidate |
| `codegraph` | Code Repository | Опциональный | Управляет repository-local CodeGraph index, native CLI passthrough и MCP/agent integration для навигации по коду |

Все три package поставляются как dependencies дистрибутива. Required означает
зависимость активного Project Template, а не встроенную бизнес-логику Core.

## OpenSpec Graph

Основные команды:

```bash
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph build
openspec-orch graph status --json
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
openspec-orch graph inspect <node-id>
openspec-orch graph view
```

Binding не создает индекс. `build` валидирует Store и атомарно заменяет локальную
проекцию. `impact`, `check-scope`, `inspect` и `view` требуют свежий authoritative
index. Explicit relations хранятся в tracked `openspec/graph.yaml` с точным
Store-relative `path:line` evidence.

Graph не читает файлы Code Repositories, не вызывает CodeGraph, не редактирует Change
и не запускается фоном.

## Change Tracking

Основные команды:

```bash
openspec-orch assign <change-id> --repo <repository-id>...
openspec-orch status <change-id> --json
openspec-orch record assignment <change-id> \
  --repo <repository-id> --commit <full-sha1> \
  --status <completed|failed|blocked> --source <human|agent|ci>
openspec-orch verify <change-id>
openspec-orch record verification <change-id> \
  --result <pass|fail> --source <human|agent|ci>
```

Cycle Record tracked в Store. Results, Snapshots и Verification Receipts локальны и
не переносятся через Git. `verify` только вычисляет идентичность набора версий и не
проводит проверку.

Change Tracking не вычисляет Graph impact и не заменяет OpenSpec Apply, PR, CI,
deployment, QA, Release или Archive.

## CodeGraph

```bash
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend --repo backend
openspec-orch plugin status --plugin codegraph
openspec-orch plugin sync codegraph --all
openspec-orch plugin exec codegraph --repo frontend -- status --json
```

`connect` вызывает `codegraph init .`, `sync` — `codegraph index .`, а `exec` передает
argv native runtime через package-owned launcher в cwd выбранного Repository.
`.codegraph/` добавляется в локальный `.git/info/exclude`; tracked `.gitignore` не
изменяется.

Plugin умеет устанавливать integration для Qwen, Claude, GigaCode и Codex. Наличие
этого adapter не означает, что Base Project Template поддерживает `--agent codex`.

## Общий lifecycle

```bash
openspec-orch plugin init
openspec-orch plugin connect <plugin-id>
openspec-orch plugin status --plugin <plugin-id>
openspec-orch plugin sync <plugin-id> --repo <repository-id>
openspec-orch plugin exec <plugin-id> --repo <repository-id> -- <command> [args...]
openspec-orch plugin disconnect <plugin-id> --repo <repository-id>
openspec-orch plugin remove <plugin-id>
```

Без явного selector интерактивный TTY показывает checkbox. В CI/non-TTY для
`connect`, `sync`, `exec` и `disconnect` задайте повторяемый `--repo` либо `--all`.
`--repo` и `--all` несовместимы. Для `connect` `--all` выбирает все подходящие
Repositories; для остальных операций — все существующие bindings.

Progress идет в `stderr`, поэтому JSON и raw stdout можно перенаправлять. После
`connect` и `sync` Core повторно читает фактический Plugin status.

`disconnect` удаляет binding, но не данные внутри Repository. `remove` требует
отсутствие bindings и запрещен для `required: true`. Доставленные Template/Agent
файлы автоматически не удаляются; CLI перечисляет их для ручной очистки.

## Внешний Plugin

`--from` принимает один локальный каталог, `.tgz`, Git URL или npm install spec:

```bash
openspec-orch plugin init \
  --plugin dependency-audit \
  --from @company/openspec-plugin-dependency-audit@1.2.0
```

Production dependencies materialize в локальный cache без lifecycle scripts. Точная
package identity сохраняется в `openspec-orch.yaml`. Внешний Plugin использует только
публичный SDK и не импортирует Core internals.

Создание каркаса:

```bash
openspec-orch plugin register dependency-audit
openspec-orch plugin register code-analyzer \
  --profile native --support code --template
```

Профили:

- `commands` — только namespaced command contribution;
- `repository` — guarded `connect/status` и command grammar;
- `native` — repository lifecycle, native `exec` adapter и launcher.

Scaffold не возвращает фиктивный `ready`: автор обязан реализовать lifecycle и
проверить package через SDK contract test kit.
