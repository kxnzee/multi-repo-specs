# Начало работы

## 1. Проверьте окружение

```bash
node --version
npm --version
git --version
openspec --version
openspec-orch --help
```

Нужен Node.js 22.16.0 или новее. Установка и обновление самого Orchestrator описаны
[отдельно](installation-and-updates.md).

До `connect` установите CLI выбранного Agent и убедитесь, что он доступен в `PATH`:

```bash
# для --agent claude
claude --version

# для --agent qwen
qwen --version

# для --agent gigacode
gigacode --version
```

Adapters Qwen и GigaCode используют совместимую грамматику Extensions, но запускают
собственные CLI: соответственно `qwen` и `gigacode`. `connect` выполняет проверку
выбранного Agent до подключения repositories и Extensions.

## 2. Создайте или клонируйте Store

`init` нужно выполнять для отдельного центрального Store Repository. Checkout
Orchestrator, каталог установленного npm-пакета и Code Repositories не являются
target для этой команды. Рекомендуемая раскладка:

```text
<workspace>/
├── multi-repo-specs/   # исходники Orchestrator — init здесь не запускать
├── specs/              # центральный Store — target команды init
└── src/                # Code Repositories подключаются позднее через connect
```

Сначала проверьте локальные регистрации OpenSpec:

```bash
openspec store list
```

`--store` задаёт стабильный ID Store. Он сохраняется в Store metadata и
`openspec-orch.yaml`, попадает в Git и должен быть одинаковым у всех участников.
Локальная регистрация OpenSpec дополнительно требует, чтобы на одной машине один
Store ID указывал только на один checkout.

Для нового Store создайте отдельный обычный каталог. Git можно настроить позже,
когда понадобится командная поставка или Change Tracking:

```bash
mkdir -p /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs
```

Последняя команда не должна выводить изменённых файлов. После этого выполните `init`.
Можно перейти в Store и использовать текущий каталог:

```bash
cd /absolute/path/to/workspace/specs
openspec-orch init . \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main
```

Либо можно остаться в другом каталоге, но тогда путь к Store должен быть передан
явно:

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main
```

В TTY можно запустить `openspec-orch init` без обязательных флагов и пройти
интерактивный выбор. В non-TTY обязательны `--store` и `--agent`.

Template `default` добавляет Extensions `spec-driven-extended` и `superpowers`. Plugins
он не устанавливает.

### Альтернатива: инициализация через MCP

MCP выполняет ту же Core-инициализацию только в каталоге текущей Agent-сессии.
Подготовьте отдельный каталог Store, установите Agent gateway и перезапустите Agent:

```bash
cd /absolute/path/to/workspace/specs
openspec-orch agent setup --agent qwen
```

Откройте новую Agent-сессию именно из корня Store, а не из checkout Orchestrator.
До любых изменений вызовите read-only tool `get_setup_context` с пустым объектом и
проверьте:

- `cwd` точно совпадает с корнем Store;
- нужные ID присутствуют в `choices.agents[].id` и `choices.templates[].id`, а
  `choices.default_template_id` соответствует ожидаемому Template;
- `doctor` не сообщает о повреждённом частично созданном Project; для нового Store
  часть проверок ожидаемо станет доступна только после init;
- в `constraints` указаны `fixed_cwd: true` и `target_role: store`;
- текущий тип каталога не входит в `constraints.forbidden_targets`:
  `orchestrator_checkout`, `template_source` или `code_repository`.

Если `cwd` указывает на `multi-repo-specs` или другой Repository, не вызывайте
`initialize_project`: завершите Agent-сессию, перейдите в корень Store и откройте
новую сессию. У `initialize_project` нет аргумента для смены target.

Если Agent всё же вызовет tool из неверного каталога, MCP вернёт ошибку
`INIT_TARGET_INVALID` с причиной и корректным примером CLI. Agent должен передать эту
причину пользователю, а не повторять вызов с тем же `cwd`.

После проверки вызовите `initialize_project`. Это MCP tool, а не shell-команда:

```json
{
  "store_id": "specs",
  "agent_id": "qwen",
  "template_id": "default",
  "repositories": [
    {
      "repository_id": "frontend",
      "remote": "ssh://git.example.org/product/frontend.git",
      "default_branch": "main"
    },
    {
      "repository_id": "backend",
      "remote": "ssh://git.example.org/product/backend.git",
      "default_branch": "main"
    }
  ]
}
```

Обязательны только `store_id` и `agent_id`. Если `template_id` не указан,
используется bundled Template по умолчанию. `repositories` можно не передавать для
Store без Code Repositories. В `repositories` перечисляются только Code Repositories:
текущий центральный Store уже задан через `store_id` и повторно туда не добавляется.
Локальный путь к Template, произвольный target,
`--workspace` через `initialize_project` не поддерживаются.

После успешной инициализации в той же Agent-сессии можно вызвать `connect_project`
с пустым объектом, а затем read-only `get_doctor_report`. `connect_project` может
клонировать зарегистрированные Code Repositories, поэтому перед его вызовом отдельно
подтвердите этот шаг.

### Существующий Store

Новый участник не запускает `init` поверх существующего Store. Получите принятый
Store ID у команды, клонируйте Store в стандартный каталог `<workspace>/<store-id>`
и убедитесь, что локальный Store ID не занят другим checkout:

```bash
git clone <store-remote> /absolute/path/to/workspace/<store-id>
cd /absolute/path/to/workspace/<store-id>
git checkout <approved-branch-or-revision>
openspec store list
```

Дальше выполняйте обычный `connect` из следующего раздела. Он регистрирует Store в
OpenSpec, подключает Code Repositories, восстанавливает standalone Extensions и
Plugin-owned Extensions для доступных Plugin packages из portable bindings. Bundled
Plugins доступны из установленной версии Orchestrator. Если локальные внешние
packages отсутствуют или устарели, `connect` восстановит их из зафиксированного
Store lockfile:

```bash
openspec-orch connect
```

Для явного восстановления packages доступен `openspec-orch package sync`.
Обычный `connect` не выбирает новые версии зависимостей.

После `connect` обязательно проверьте `doctor`, Agent gateway и
`plugin status`. Если Store ID уже указывает на другой путь, сначала разрешите конфликт
локальной регистрации; не изменяйте identity клонированного Store. Если Store клонирован
не в `<workspace>/<store-id>`, передайте `--workspace` явно, как показано ниже.

## 3. Подключите машину

```bash
cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch doctor
```

Отсутствующие Code Repositories клонируются в `<workspace>/src/`. Существующие
каталоги используются без обновления и без проверок Git origin, ветки или чистоты.

`connect` доставляет из Store OpenSpec-команды и skills выбранного Agent в каждый
Code Repository, а workflow Extensions подключает по ролям из их `targets`.
Создание команд, skills или OpenSpec pointer даёт результат `files_changed`.
Сохраните их по процессу команды. Повторный `connect` не считает совпадающие файлы
новыми и не проверяет, закоммичены ли они. Настройки Agent и
пользовательские commands/skills не копируются. Отличающиеся файлы OpenSpec
останавливают доставку с `AGENT_PACK_CONFLICT`: сначала согласуйте их обновление
со Store. `disconnect` отключает native Extensions, сохраняя доставленные файлы.

Для другой раскладки один раз передайте workspace:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

Workspace сохраняется после успешного подключения. Режимов strict/relaxed больше нет;
старое поле `strict` в конфигурации игнорируется.

## 4. При необходимости установите Agent gateway

Для инициализации через MCP gateway нужно установить до запуска Agent-сессии, как
показано выше. При обычной CLI-инициализации этот шаг можно выполнить после `connect`.

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Перезапустите Agent после установки. Gateway ставится в user scope и используется
всеми Projects этого Agent.

## 5. Подключите нужные Plugins

Например, для проверки Store graph:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch plugin exec openspec-graph inspect --json
```

Остальные варианты описаны в [руководстве Plugins](plugins.md).

## 6. Создайте Change

```bash
openspec new change update-copy --schema spec-driven-extended
# либо
openspec new change redesign-checkout --schema superspec-multirepo
```

Дальше используйте [единый процесс поставки](story-delivery-process.md); он описывает
как командное, так и одиночное выполнение.

Для нового участника итоговая последовательность выглядит так:

```text
проверка Agent CLI → clone Store → connect → doctor
→ agent setup/status → plugin status → перезапуск Agent → работа с Change
```
