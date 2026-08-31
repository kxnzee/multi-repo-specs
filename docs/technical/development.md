# Разработка Orchestrator

## Структура

| Путь | Назначение |
|---|---|
| `bin/` | Distribution entrypoints |
| `packages/core/` | Generic domain, use cases и adapters |
| `packages/plugin-sdk/` | Public Plugin API и test kit |
| `packages/mcp/` | Governed stdio MCP |
| `plugins/` | First-party Plugin packages |
| `agents/` | Provider definitions и adapters |
| `extensions/` | Standalone Agent payloads |
| `templates/` | Project Template catalog |
| `test/` | Distribution и structural tests |

Tests внутри packages находятся рядом с owning code и обнаруживаются нативным
`node --test`.

## Архитектурные правила

- Core остаётся generic и не знает ID или domain grammar Plugins.
- Plugins импортируют только публичный SDK.
- Project-specific context и schemas принадлежат Template.
- Agent workflow artifacts принадлежат Extensions.
- Observable behavior получает regression test.
- Machine-readable stdout не смешивается с progress.
- Paths, cwd и lifecycle mutations остаются scoped и fail-closed.

## Добавление Plugin

1. Создайте package через `plugin register` или вручную.
2. Реализуйте contributions через публичный SDK.
3. Сделайте `status` фактической проверкой.
4. Добавьте package tests и SDK contract test.
5. Для bundled Plugin добавьте dependency и запись в root
   `openspecOrchestrator.bundledPlugins`.
6. Проверьте packing и installation smoke.

## Agent, Extension и Template

Новый Agent добавляется в `agents/<id>/`; provider-specific CLI остаётся в adapter.
Bundled Extension содержит descriptor и manifests поддерживаемых Agents. Plugin-owned
Extension возвращается через SDK с точным target.

Bundled Template находится в `templates/<id>/`; directory name совпадает с
`template.yaml.id`. Если workflow требует Extension, descriptor объявляет её через
`requires.extensions`.

## Проверки

```bash
npm run lint
npm run test:code
npm run check
git diff --check
node bin/openspec-orch.js --help
```

Перед публикацией:

```bash
npm pack --dry-run
npm pack --workspaces --dry-run
```

Unit tests не подтверждают реальный Agent runtime, Git hosting, native CodeGraph или
произвольную OpenSpec version. Изменение такой границы требует isolated smoke.

## Review checklist

- public contract и tests согласованы;
- Core/SDK/Plugin boundaries сохранены;
- path и process scope не расширены;
- mutation выполняется после validation;
- unknown state не мигрируется молча;
- Template не перезаписывает user-owned files;
- документация описывает реализованное поведение.
