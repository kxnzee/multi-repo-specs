# Plugins

Plugin — отдельный CLI-адаптер, который Orchestrator подключает к выбранным
Repository. Его Package не входит в Project Template и устанавливается в отдельный
Store-local cache; необязательными Agent hooks он может управлять только собственными
project-local MCP entries и инструкциями.

## Основной lifecycle

Из корня Store выполните:

```bash
openspec-orch plugin init
openspec-orch plugin connect <plugin-id>
openspec-orch plugin status
```

`plugin init` показывает checkbox пакетов стандартной поставки. В том же интерфейсе
можно добавить Plugin Package из каталога, `.tgz`, Git URL или npm registry. `connect`
показывает repositories, с которыми нужно связать выбранный Plugin.

Если Plugin объявляет Agent integration, `plugin init` дополнительно вызывает её для
каждого Agent ID, сохранённого командой `openspec-orch init`. Сам Plugin владеет
форматом MCP-конфига и инструкций конкретного агента; Core только запускает объявленный
hook. После изменения MCP-конфига перезапустите агент.

Для CI и скриптов те же действия доступны без prompt:

```bash
openspec-orch plugin init --from ../team-plugins --plugin dependency-audit
openspec-orch plugin init --from @company/openspec-plugin-jira@1.2.0 --plugin jira
openspec-orch plugin init --from ./dependency-audit-2.0.0.tgz --plugin dependency-audit
openspec-orch plugin connect dependency-audit --repo frontend --repo backend
openspec-orch plugin status --plugin dependency-audit --json
openspec-orch plugin sync dependency-audit --repo frontend
openspec-orch plugin disconnect dependency-audit --repo frontend
openspec-orch plugin remove dependency-audit
```

`remove` разрешён только после отключения Plugin от всех repositories. `disconnect`
удаляет связь из project config, но намеренно не удаляет данные, созданные инструментом
в Repository. Общий `plugin status` проверяет связи параллельно, но запускает не более
четырёх внешних Plugin-процессов одновременно.

## Нативная команда

После `connect` Plugin доступен как namespace основного CLI:

```bash
openspec-orch dependency-audit --repository frontend scan
```

Orchestrator проверяет project config и запускает Plugin с `cwd` точно в выбранном
Repository. Package entrypoint разрешается из конкретной установки Plugin, поэтому
он не зависит от глобального `PATH`. Дополнительная JSON-обёртка `--input` не нужна:
оставшиеся аргументы передаются нативному CLI без shell.

## Пользовательский Plugin

Новый Plugin Package создаётся одной командой, которую можно выполнить вне Store:

```bash
openspec-orch plugin register dependency-audit
openspec-orch plugin register dependency-audit ../team-plugins/dependency-audit \
  --name "Dependency Audit" --support store --support code
```

Без явного пути создаётся `./plugins/dependency-audit/`. Внутри уже находятся
`package.json`, `plugin.yaml`, `README.md` и исполняемый
`bin/dependency-audit.js`. После регистрации автор меняет только содержимое этого
Package, добавляет его локальные dependencies и устанавливает готовую версию через
`plugin init --from`; правки Core не нужны.

Plugin Package содержит обычный npm `package.json` и отдельный доменный
`plugin.yaml`. `package.json` владеет dependencies и необязательным entrypoint:

```json
{
  "name": "@company/openspec-plugin-dependency-audit",
  "version": "1.0.0",
  "openspecOrchestrator": {
    "apiVersion": 1,
    "manifest": "plugin.yaml",
    "entrypoint": "bin/dependency-audit.js"
  },
  "dependencies": {
    "dependency-audit": "4.2.0"
  }
}
```

`plugin.yaml` остаётся простым и не содержит package/runtime details. Операции
`connect` и `status` обязательны; `sync` можно не объявлять:

```yaml
id: dependency-audit
name: Dependency Audit
version: 1.0.0
type: cli
command: dependency-audit
args: []
supports: [code]
lifecycle:
  connect: [init, .]
  status: [status, .]
  sync: [sync, .]
```

Plugin, которому нужно настроить окружение агента, может добавить два симметричных
hook. Core передаёт им `--agent <agent-id>` и запускает entrypoint из корня Store:

```yaml
agent:
  install: [agent, install]
  remove: [agent, remove]
```

Эта секция необязательна. Реализация hook, перечень поддерживаемых агентов, MCP server
и project-local инструкции находятся только внутри Plugin Package. `plugin remove`
вызывает `agent.remove` до удаления локального пакета и не трогает чужие записи в
конфигах агента.

При `plugin init` пакет атомарно materialize в
`.openspec-orch/cache/plugins/<plugin-id>/` один раз на Store и затем может быть
подключён к любому числу repositories. Production dependencies устанавливаются
внутри этого Package с отключёнными lifecycle scripts. Symlink и специальные файлы
запрещены.

Если Package объявляет `entrypoint`, Core запускает его текущим Node.js. Без
`entrypoint` поле `command` остаётся именем внешнего executable из `PATH`. Core не
импортирует Plugin JavaScript в свой процесс и не содержит ветвлений по Plugin ID.

Event hooks, permissions, secrets, marketplace и Plugin SDK в текущий контракт не входят.
