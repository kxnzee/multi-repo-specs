# OpenSpec Graph

OpenSpec Graph строит и проверяет связи Store, Master Specs, Changes и Repository
Impact. Он работает с основным Store и подключёнными Store в роли `specs`.

Подключите Graph к Store и проверьте его:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch plugin exec openspec-graph inspect --json
openspec-orch plugin exec openspec-graph view --port 0
```

Для Store другой команды добавьте его как репозиторий с ролью `specs`, затем
подключите Graph к локальному ID этого Store. Graph читает Master и Delta Specs,
а также таблицу Repository Impact из Proposal. Он не читает код и не доказывает
факт реализации.

После `connect` или обновления начните новую сессию агента. В MCP доступны
`get_spec_graph`, `get_spec_graph_node` и `get_spec_change_impact`; их область
действия описана в [справочнике Core](../core/reference.md#области-действия-и-идентификаторы).

Полный контракт плагина находится в [исходном README](../../plugins/openspec-graph/README.md).
