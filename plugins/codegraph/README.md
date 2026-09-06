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

## Agent Extension

После успешного connect Plugin активирует Extension в workspace target Repository.
Она подключает stdio executable `openspec-orch-codegraph` и общие инструкции:

- Claude получает local Plugin;
- Qwen и GigaCode получают project Extension;
- GigaCode использует отдельный manifest через Qwen-compatible adapter.

После connect или disconnect перезапустите Agent и проверьте доступность
`codegraph_explore`. Disconnect деактивирует Extension и удаляет binding, но не
обязан удалять установленный provider package или index data.

## Правила использования

1. Сначала выберите конкретный Repository и технический вопрос.
2. Подтвердите Git root, revision и clean working tree.
3. Используйте `codegraph_explore` для карты реализации.
4. При stale/отсутствующем index перейдите к обычному read/search в том же checkout.
5. Не считайте граф доказательством runtime behavior, теста или внешнего контракта.

Store binding не открывает соседние Code Repositories; каждый checkout исследуется
отдельно.
