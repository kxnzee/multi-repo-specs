# Архитектура

## Состав

```text
bin/openspec-orch.js          CLI composition root
bin/openspec-orch-mcp.js      MCP composition root
packages/core/                generic orchestration
packages/plugin-sdk/          public Plugin API
packages/mcp/                 governed stdio MCP
plugins/                      first-party Plugins
agents/                       provider definitions and adapters
extensions/                   bundled Agent payloads
templates/                    bundled Project Templates
```

Root `package.json` определяет default Template, bundled Plugins и разрешённые
root-команды. Core не импортирует конкретные Plugins; Plugins не импортируют Core.

## Границы компонентов

| Компонент | Владеет |
|---|---|
| Core | Project/Repository model, init/connect, safe I/O, Plugin host |
| Plugin SDK | Immutable Plugin API, command builder, contract tests |
| Plugin | Domain logic, package state, commands и Extensions |
| Project Template | Copy-only project context, schemas и assets |
| Agent adapter | Native OpenSpec/Extension lifecycle конкретного provider |
| MCP | Fixed protocol allowlist и stdio transport |
| OpenSpec | Specs, Changes, schema и artifact operations |

## Init

`init` проверяет Store ID и выбранный Agent, запускает OpenSpec init, адаптирует
provider pack, безопасно применяет Template, разрешает required/optional Extensions и
пишет `openspec-orch.yaml`.

Операция fail-closed для неизвестных IDs, path traversal, symlink, collision,
неполного provider pack и попытки перезаписать отличающийся файл. Plugins на этом
этапе не подключаются.

## Connect

`connect`:

1. читает strict project config;
2. выполняет preflight Agent и OpenSpec;
3. проверяет или клонирует Code Repositories;
4. сохраняет выбранный workspace;
5. активирует standalone Extensions;
6. восстанавливает Plugin runtimes и Plugin-owned Extensions;
7. проверяет итоговый status.

Существующий checkout не получает `pull`, `checkout`, `reset` или merge.
Relaxed mode не клонирует и не pin-ит Git state.

## Plugin lifecycle

`plugin init` разрешает bundled/external package, валидирует manifest и сохраняет
exact declaration. `plugin connect` создаёт scoped context, выполняет repository
callback, активирует Extension contribution и только после общего успеха сохраняет
binding.

`disconnect` отключает Extension и удаляет binding, но не tool-owned data.
`remove` требует отсутствия bindings.

## Graphs и tracking

OpenSpec Graph каждый раз компилирует Store files в детерминированный report.
CodeGraph обслуживает один локальный index на binding и не передаёт свою модель в
Store. Change Tracking хранит активную attempt локально, а завершённую связь
OpenSpec task с revisions — внутри Change.

Эти Plugins независимы и не меняют OpenSpec Apply.

## MCP

`@openspec-orch/mcp` — встроенный stdio adapter. CLI и MCP вызывают общие Core и
public Plugin application services. Read resources ограничены Store allowlist; setup
tools используют тот же `ProjectSetupService`, что CLI.

MCP не предоставляет arbitrary Git writes, verification, Release, Archive,
Plugin lifecycle, Agent management или network transport.

## Safe facades

Plugin получает scoped Files, Git, Process, Storage и immutable
Project/Repository handles. Paths и cwd проверяются Core, процесс запускается без
shell interpolation, local state записывается через versioned envelope и atomic
replace.
