# MCP Connector

MCP Connector — один agent-only Plugin стандартной поставки, который синхронизирует
декларативный `mcp-connector.yaml` в Store с `mcpServers` зарегистрированного Agent.
Новый MCP добавляется YAML-записью, а не новым Plugin package.

## Конфигурация

Скопируйте [`examples/mcp-connector.yaml`](examples/mcp-connector.yaml) в корень
Store под именем `mcp-connector.yaml` и замените server ID и содержимое `settings`.

```yaml
version: 1
servers:
  company-search:
    agents: [qwen, gigacode, claude]
    settings:
      command: company-search-mcp
      args: ["--stdio"]
    context: |
      Используй `company-search` для поиска внутренних сервисов.
      Не изменяй данные без явного запроса пользователя.

  internal-docs:
    agents: [qwen]
    settings:
      url: http://mcp.internal.example/mcp
```

`settings` — непустой JSON-совместимый object. Connector не интерпретирует его поля:
допустимый transport contract определяет конкретный Agent. Необязательный `context` —
непустой Markdown-текст с инструкцией, когда и как использовать MCP. `agents`
необязателен; без него server и его context применяются к любому Agent, для которого
Connector имеет adapter.

Не храните credentials в YAML. Используйте принятую Agent схему environment/secret
references. MCP executable или внутренний endpoint должны быть доступны внутри
закрытого контура независимо от Connector.

## Lifecycle

```bash
openspec-orch plugin init --plugin mcp-connector
openspec-orch mcp status
openspec-orch mcp apply
```

`plugin init` сразу выполняет первый apply. Отсутствующий config допустим только пока
Connector ничем не управляет. Чтобы удалить server, удалите его YAML entry и выполните
`mcp apply`. Чтобы удалить все integration entries и сам Plugin:

```bash
openspec-orch plugin remove mcp-connector
```

Connector хранит exact definitions управляемых entries в локальном Plugin storage.
Он обновляет и удаляет только owned entries, сохраняет остальные settings и
останавливается, если принадлежащая ему запись была изменена вручную. Context всех
подходящих servers собирается в один маркированный managed block. Остальной текст
instruction-файла не меняется; ручное изменение managed block также останавливает
apply/remove.

Поддерживаемые settings paths:

- Claude: `.mcp.json`;
- Qwen: `.qwen/settings.json`;
- GigaCode: `.gigacode/settings.json`.

Соответствующие instruction paths: `CLAUDE.md`, `QWEN.md` и `GIGACODE.md`.

## Проверка нового MCP

После `mcp apply` перезапустите Agent и проверьте реальный MCP `initialize`,
`tools/list` и один безопасный tool call. Успешный merge settings не доказывает
доступность MCP runtime, сети, credentials или конкретных tools.
