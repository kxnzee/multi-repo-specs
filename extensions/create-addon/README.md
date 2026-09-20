# Создание дополнений Orchestrator

Extension предоставляет навык create-addon для создания Extension, Plugin и
Template через `openspec-orch create`. Расширение поставляется вместе с
Orchestrator и подключается отдельно; установленный и настроенный агент обязателен
только для использования навыка.

Из тестового Store:

```bash
openspec-orch extension init create-addon
openspec-orch extension connect create-addon
openspec-orch extension status create-addon
```

Откройте новую сессию агента и попросите создать дополнение через create-addon.
CLI можно использовать самостоятельно, без агента и Store.
