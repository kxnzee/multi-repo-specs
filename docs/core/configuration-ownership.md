# Владение конфигурацией

У каждой настройки Orchestrator есть один канонический владелец. Не переносите
настройки разных слоёв в общий файл: это смешает runtime distribution, независимые
packages и copy-only материалы, которые команда проекта меняет после `init`.

| Что настраивается | Каноническое место | Не дублировать в |
|---|---|---|
| Состав npm workspaces, версия distribution, Node floor, bundled Plugins и default Template | корневой `package.json` | коде CLI, Plugin manifests и Templates |
| Generic paths, форматы, версии и grammar Core | `src/packages/core/internal/constants.js` | Plugins, Templates и Agent adapters |
| UI init, Plugin scaffold, prompts и status presentation Core | соответствующий `*-config.js` рядом с owning service в `src/packages/core/internal/` | общем Core constants и CLI handlers |
| Native grammar Claude/Qwen/GigaCode, manifests, status markers и payload bookkeeping | `src/agents/config.js` | provider mapper и protocol modules |
| Один Agent provider: identity, executable, OpenSpec target и native manifest | `src/agents/<id>/agent.yaml` | `src/agents/config.js` |
| Plugin package metadata и Plugin-owned defaults | `plugins/<id>/package.json` и собственный `lib/config.js`, если он нужен | Core и root package |
| Политика read-only ресурсов MCP | `src/packages/mcp/lib/resources-config.js` | Core, Plugins и Templates |
| Standalone Extension descriptor и provider manifests | `extensions/<id>/extension.yaml` и соседние native manifests | Core и Template |
| Copy-only Project Template, schema и project context | `templates/<id>/template.yaml` и `templates/<id>/openspec/` | runtime Core и Extensions |
| Проверочная среда и packaging smoke | `scripts/verification/` | production configuration |
| Synthetic fixtures | `test-fixtures/` или test-local fixtures | shipped manifests |

## Как менять настройку

1. Сначала определите её владельца по таблице.
2. Измените только канонический источник и его tests.
3. Обновите потребителей вместо копирования значения.
4. Если значение должно пересечь package boundary, сначала оформите публичный contract;
   внутренние config-модули одного package не импортируются другим package.

Agent adapters иллюстрируют правило: `agent.yaml` определяет provider identity и
файлы, а `src/agents/config.js` — shared native CLI grammar и provider overrides.
Оба источника нужны, потому что первое — package descriptor одного Agent, второе —
implementation configuration общего protocol layer.
