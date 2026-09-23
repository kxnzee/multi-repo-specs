# CodeGraph Plugin

`@openspec-orch/plugin-codegraph` управляет локальным CodeGraph index выбранного
Store или Code Repository и подключает Repository-scoped Agent Extension.

Каждый binding имеет собственный cwd и `.codegraph/`. Индекс не коммитится и не
копируется в центральный Store. CodeGraph помогает читать текущую реализацию, но не
создаёт Requirements и не расширяет scope Change.

## Подключение

```bash
cd <store>
openspec-orch plugin init --plugin codegraph
openspec-orch plugin connect codegraph --repo frontend
openspec-orch plugin status --plugin codegraph --repo frontend
```

`connect` запускает `codegraph init .`. Обновление и native passthrough:

```bash
openspec-orch plugin sync codegraph --repo frontend
openspec-orch plugin exec --repo frontend codegraph explore "authentication flow"
openspec-orch plugin exec --all codegraph status --json
```

Перед индексированием Plugin добавляет `.codegraph/` в локальный
`.git/info/exclude`; tracked `.gitignore` не меняется. Отдельная global установка
CodeGraph не нужна: runtime принадлежит package.
Passthrough `init` принимает флаги перед путём, например `init --force .`.
`init --help` выводит справку native CLI без изменения `.git/info/exclude`.

## Agent Extension

После успешного connect Plugin активирует Extension в workspace target Repository.
Она добавляет общие инструкции использования CodeGraph:

- Claude получает local Plugin;
- Qwen и GigaCode получают project Extension;
- GigaCode использует отдельный manifest через Qwen-compatible adapter.

Сам `codegraph_explore` принадлежит Agent contribution этого Plugin и публикуется
через общий `openspec-orchestrator` MCP. Поэтому Store-сессия и созданный ею
subagent используют один каталог инструментов, даже если CodeGraph подключён только
к Code Repository. Вызов принимает `repository_id`, а Orchestrator разрешает
соответствующий checkout только через активный binding; путь от модели не принимается.

После connect или disconnect перезапустите Agent или его долгоживущий MCP-процесс и
проверьте доступность `codegraph_explore`. Disconnect деактивирует Extension и
удаляет binding, но не обязан удалять установленный provider package или index data.
Если готовый binding уже существует, но текущая Agent-сессия не получила MCP tool,
Extension проверяет `plugin status --json` и использует read-only
`plugin exec --repo <repository-id> codegraph explore` как CodeGraph fallback. Это не
разрешает обычный поиск по исходникам и не запускает `sync` или reconnect.

## Правила использования

1. Сначала выберите конкретный Repository и технический вопрос.
2. Подтвердите Git root, revision и clean working tree.
3. Вызовите `codegraph_explore` с `repository_id` и одним вопросом с точными anchors.
4. При недоступном MCP tool используйте Plugin-owned CLI fallback; при
   stale/отсутствующем index перейдите к обычному read/search в том же checkout.
5. Не считайте граф доказательством runtime behavior, теста или внешнего контракта.

Store binding не открывает соседние Code Repositories; каждый checkout исследуется
отдельно.
