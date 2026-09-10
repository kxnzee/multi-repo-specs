# Быстрый старт

Этот маршрут создаёт новый Store с двумя репозиториями кода. Нужны Node.js 22.16.0
или новее, Git, OpenSpec и клиент выбранного агента. Установку Orchestrator и
OpenSpec см. в [руководстве по установке](installation-and-updates.md).

Создайте отдельный каталог для Store. Не запускайте `init` в исходниках
Orchestrator или в репозитории кода.

```bash
mkdir -p /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs

openspec-orch init . \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main
```

Подключите репозитории и проверьте окружение:

```bash
openspec-orch connect
openspec-orch doctor
```

Для доступа агента к контексту и инструментам установите шлюз, затем перезапустите
клиент агента:

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Теперь можно создать Change:

```bash
openspec new change update-copy --schema spec-driven-extended
```

Дальше выберите [сценарий работы с Change](../templates/default.md). Для
подключения к уже существующему Store используйте [полное руководство по началу
работы](getting-started.md).
