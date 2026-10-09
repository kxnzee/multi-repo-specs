# Настройка через агента (MCP)

Проект можно создать и подключить командами `openspec-orch` в терминале, а можно
попросить об этом GigaCode. Во втором случае агент вызывает инструменты
Orchestrator через MCP, а вы подтверждаете каждое изменение. Результат одинаковый.

Перед началом выполните [установку](installation.md) до шага 3 включительно.

## 1. Зарегистрируйте агента

Чтобы GigaCode видел инструменты Orchestrator, на машину один раз ставится шлюз:

```bash
openspec-orch agent setup --agent gigacode
openspec-orch agent status --agent gigacode
```

`agent setup` регистрирует в GigaCode MCP-сервер `openspec-orchestrator` и
инструкции к нему. Регистрация пользовательская: она действует во всех проектах
этой машины, в Store её ничего не записывает. После установки перезапустите
GigaCode.

MCP-сервер запускается из каталога, в котором вы открыли GigaCode, и работает
только с ним. Поэтому каталог, из которого открывается сессия, важен на каждом
шаге ниже.

Что агент может делать через шлюз:

| Инструмент | Что делает | Меняет файлы |
|---|---|---|
| `get_setup_context` | Показывает доступных агентов, Templates и ограничения для текущего каталога | Нет |
| `initialize_project` | Создаёт Store в текущем каталоге | Да |
| `connect_project` | Подключает проект: клонирует репозитории, ставит команды и расширения | Да |
| `get_doctor_report` | То же, что `openspec-orch doctor` | Нет |
| `get_status`, `get_change_context`, `get_next_action` | Состояние проекта и Change для работы по этапам | Нет |

Инструменты, которые меняют файлы, агент вызывает только по вашей явной просьбе.

## 2. Новый проект

1. Создайте пустой каталог Store и откройте в нём GigaCode:

   ```bash
   mkdir -p /absolute/path/to/workspace/specs
   cd /absolute/path/to/workspace/specs
   gigacode
   ```

2. Опишите агенту проект обычным текстом. Например:

   ```text
   Создай проект OpenSpec Orchestrator в текущем каталоге.
   Store ID: specs, remote ssh://git.example.org/product/specs.git, ветка main.
   Агент gigacode, Template default.
   Репозитории кода:
   - frontend: ssh://git.example.org/product/frontend.git, ветка main,
     личный кабинет клиента на React и TypeScript;
   - backend: ssh://git.example.org/product/backend.git, ветка main,
     API и платёжная логика на Node.js и PostgreSQL.
   ```

3. Агент вызовет `get_setup_context` и покажет, что получилось. Проверьте:
   - `cwd` совпадает с каталогом Store;
   - в `constraints` указаны `fixed_cwd: true` и `target_role: store`;
   - нужные агент и Template есть в списках `choices`.

   Если `cwd` указывает не туда (исходники Orchestrator, репозиторий кода, другой
   каталог), остановитесь: закройте GigaCode и откройте его в каталоге Store.
   Сменить каталог из сессии нельзя.

4. Агент покажет параметры для `initialize_project`. Проверьте Store ID и список
   репозиториев и подтвердите. Сам Store в список репозиториев кода не входит.
5. После создания попросите подключить проект. Агент вызовет `connect_project`;
   он клонирует репозитории в `<workspace>/src/`, поэтому агент спросит
   подтверждение.
6. Попросите проверить результат. Агент вызовет `get_doctor_report`.

Дальше так же, как при настройке из терминала: [бизнес-контекст, плагины и
публикация Store](new-project.md#5-заполните-бизнес-контекст).

## 3. Подключение к существующему проекту

1. Клонируйте Store в `<workspace>/<store-id>`. Это делается в терминале:

   ```bash
   git clone <store-remote> /absolute/path/to/workspace/specs
   ```

2. Откройте GigaCode в `<workspace>/specs/` и попросите: «Подключи проект».
   Агент вызовет `connect_project` и после вашего подтверждения клонирует
   репозитории и поставит команды.
3. Попросите проверить подключение: агент вызовет `get_doctor_report`.

`connect_project` не принимает другой workspace. Если Store лежит не в
`<workspace>/<store-id>`, подключите его из терминала:
`openspec-orch connect --workspace <путь>`. Ошибку «Store ID уже зарегистрирован»
исправляйте так же, как описано в [подключении к проекту](join-project.md#если-store-id-уже-зарегистрирован).

## Что через агента сделать нельзя

- Установить или обновить шлюз: только `openspec-orch agent setup`.
- Подключать, обновлять и удалять плагины и расширения: только CLI, см.
  [плагины и расширения](../plugins/operations.md).
- Выбрать для `initialize_project` свой Template по пути или другой каталог.

Если инструмент отказал, агент должен показать причину и остановиться, а не
повторять вызов. Например, `INIT_TARGET_INVALID` значит, что сессия открыта не в
каталоге Store. Справочник по инструментам MCP есть в
[техническом справочнике](../core/reference.md#mcp).
