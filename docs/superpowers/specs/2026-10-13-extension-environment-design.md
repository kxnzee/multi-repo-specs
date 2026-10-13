# Переменные окружения Extensions до подключения

Дата: 2026-10-13. Статус: черновик на ревью.

## Цель

Extension может требовать персональные значения пользователя, например токен для
MCP-сервера, который она подключает. Перед нативной установкой Orchestrator сам
определяет по манифесту Extension, какие переменные окружения ей нужны, проверяет,
что они заданы, и интерактивно предлагает ввести недостающие. Введённые значения
сохраняются в окружение пользователя, и агент получает их после перезапуска.

Пользователь не устанавливает ничего вручную: достаточно команды подключения,
которую он и так выполняет.

### Критерии успеха

- `openspec-orch connect` в терминале запрашивает каждую недостающую переменную
  всех Extensions проекта (standalone и Plugin-owned) один раз и затем подключает
  Extensions без ошибок.
- `extension connect <id>` и `plugin connect <id>` делают то же для своего набора
  Extensions.
- Уже заданная непустая переменная не запрашивается.
- Без терминала (MCP, CI) команда не устанавливает ни одной Extension и называет
  недостающие переменные и команду, которую нужно выполнить в терминале.
- Значения не попадают в stdout, тексты ошибок, `openspec-orch.yaml`, Store или Git.
- Новый процесс агента, запущенный после команды, видит переменные в окружении.

### Вне области

- Интеграция с хранилищами настроек агентов (`claude plugin configure`,
  `qwen extensions settings`, keychain).
- Новые поля в `extension.yaml` и изменения Extension SDK или Plugin SDK.
- Изменение окружения уже запущенного терминала или агента. Это технически
  невозможно, нужен перезапуск.
- Удаление сохранённых значений при `disconnect` или `remove`.

## Источник требований: нативный манифест

Список берёт адаптер выбранного агента в `src/agents/`. Каждый элемент:
`{ name, description, sensitive }`.

| Agent | Источник | Поля |
|---|---|---|
| `qwen`, `gigacode` | `settings[]` в manifest агента | `envVar` → `name`; `description`; `sensitive` (по умолчанию `false`) |
| `claude` | `${VAR}` в MCP-конфиге Plugin: `mcpServers` в `.claude-plugin/plugin.json` как объект или путь к JSON-файлу внутри Extension | `name` = `VAR`; `description` — «нужна MCP-серверу `<server>`»; `sensitive: true` |

Правила:

- Имя переменной соответствует `^[A-Za-z_][A-Za-z0-9_]*$`, иначе
  `AGENT_EXTENSION_INVALID`.
- Для Qwen и GigaCode `settings` отсутствует или является массивом объектов со
  строковым `envVar`. Некорректная структура даёт `AGENT_EXTENSION_INVALID` уже
  в `validateExtension`, то есть в preflight.
- Для Claude рекурсивно просматриваются строковые значения MCP-конфига.
  Не требуются: `${VAR:-default}` (у неё есть значение по умолчанию), `CLAUDE_*`
  (их задаёт Claude) и `${user_config.*}`. Путь к MCP-файлу читается через
  существующий `readNativeManifest`, без symlink и без выхода из Extension root.
- Порядок элементов стабилен: в порядке появления, без повторов.

## Компоненты

### 1. Операция адаптера `requiredEnvironment`

- `src/agents/extension-cli.js` и `src/agents/claude-plugin.js` реализуют
  `requiredEnvironment(extension, agent, { nativeId })`.
- `createNativeExtensionAdapter` в `src/agents/native-extension.js` принимает её
  как обязательную функцию и экспортирует.
- `AgentExtensionAdapter` (Core) получает метод
  `requiredEnvironment(extension, { agentId, ownerId })`. Он маршрутизирует вызов
  так же, как `validateExtension`. `isAgentExtensionAdapter` требует новый метод.

Операция только читает файлы и не запускает нативный CLI.

### 2. Сбор требований в lifecycle

- `ExtensionLifecycle.requiredEnvironment({ extensionId } = {})` проходит по
  объявленным standalone Extensions (или по одной), разрешает каждую через
  `manager.resolve` и вызывает адаптер для агента Store.
- `PluginHost.requiredEnvironment({ pluginId, storeProject, repositoryId })`
  переиспользует `#prepareExtensions` для контекста репозитория и вызывает
  адаптер с `ownerId`.
- `PluginLifecycle.requiredEnvironmentSelected()` и
  `PluginLifecycle.requiredEnvironment({ pluginId, repositoryIds })` обходят
  bindings так же, как `connectSelected` и `connectMany`.

Каждый источник возвращает `[{ name, description, sensitive, owner }]`, где `owner`
— ID Extension или Plugin для текста запроса.

### 3. `ExtensionEnvironment` (Core, `internal/setup/`)

`ensure(requirements, { interactive })`:

1. Объединяет требования по `name`. Описания разных владельцев собираются вместе;
   `sensitive` становится `true`, если хотя бы один владелец так считает.
2. Отбирает переменные без непустого значения в `process.env` и в
   `UserEnvironment.read()`. Значение из `UserEnvironment` копируется в `process.env`
   текущего процесса.
3. Если недостающих нет, ничего не делает.
4. Если `interactive` равно `false` (stdin или stdout не TTY), бросает
   `EXTENSION_ENV_MISSING: GITLAB_TOKEN (gitlab-mcp), …; выполните
   openspec-orch connect в терминале`.
5. Иначе выводит в stderr заголовок «Extensions проекта требуют переменные
   окружения» и запрашивает каждую переменную через `@inquirer/prompts`:
   `password` для `sensitive`, `input` для остальных. Пустое значение и перевод
   строки не принимаются. Ctrl+C прерывает команду с
   `EXTENSION_ENV_CANCELLED`, и ничего не сохраняется.
6. Сохраняет все введённые значения одной записью через `UserEnvironment.write` и
   присваивает их в `process.env`.
7. Возвращает `{ saved: [names] }`. CLI по нему печатает в stderr: «Переменные
   сохранены: …. Перезапустите агента, чтобы он их увидел».

Prompt и TTY-детектор внедряются через конструктор для тестов.

### 4. `UserEnvironment` (Core, `internal/infrastructure/`)

Общий сервис персистентных пользовательских переменных, без знаний о Extensions.

- `read()` → `Map<name, value>` значений, которые сохранил Orchestrator.
- `write(entries)` атомарно сохраняет набор и возвращает список изменённых имён.

POSIX (macOS, Linux):

- Файл `~/.config/openspec-orch/env` (или `$XDG_CONFIG_HOME/openspec-orch/env`)
  с правами `0600`, каталог `0700`. Формат — строки `export NAME='value'` с
  POSIX-экранированием одинарной кавычки. Запись выполняется атомарно через
  существующий `atomicWriter`.
- В профиль shell один раз добавляется блок с маркером:

  ```sh
  # >>> openspec-orch env >>>
  [ -f "$HOME/.config/openspec-orch/env" ] && . "$HOME/.config/openspec-orch/env"
  # <<< openspec-orch env <<<
  ```

  Профиль выбирается по `$SHELL`: `zsh` → `~/.zshrc`, `bash` → `~/.bashrc`,
  иначе `~/.profile`. Если маркер уже есть, профиль не меняется.

Windows:

- Значения пишутся в `HKCU\Environment` командой
  `reg add HKCU\Environment /v NAME /t REG_SZ /d value /f`. Её запускает
  `ScopedProcess` без shell. Значение не попадает в текст ошибки: используется
  `sensitiveValues` у `ScopedProcess.run`.
- `read()` читает те же имена через `reg query`.
- Уже открытые процессы изменение не увидят. Новый терминал и агент из Explorer
  увидят его после рассылки `WM_SETTINGCHANGE`. Рассылка делается небольшой
  PowerShell-командой; если она недоступна, CLI просит перезайти в систему.

Ошибки записи → `USER_ENVIRONMENT_WRITE_FAILED: <путь или reg>`; Extensions не
устанавливаются.

### 5. Точки вызова

| Команда | Где | Набор требований |
|---|---|---|
| `openspec-orch connect` | `ProjectSetup.connect` после `#connection.connect` и до цикла `connectSelected` | Все standalone Extensions и все Plugin bindings Store |
| `extension connect <id>` | `ExtensionLifecycle.connect` после preflight и до `#invokeTargets` | Одна Extension |
| `plugin connect <id>` | `PluginLifecycle.connectMany` до цикла `host.connect` | Extensions одного Plugin для выбранных репозиториев |
| `connect` через MCP | Тот же `ProjectSetup.connect`, `interactive: false` | Как у `connect`; при недостающих переменных — ошибка |

Почему в `connect` шаг стоит после клонирования, а не сразу после preflight:
Plugin-owned Extensions вычисляются в контексте репозитория кода, и до клонирования
его может не быть. Клонирование и доставка OpenSpec-файлов идемпотентны,
повторный `connect` безопасен. Если ввод прерван, ни одна Extension не установлена,
и следующий `connect` продолжит с этого места.

`interactive` вычисляет CLI-слой (`process.stdin.isTTY && process.stderr.isTTY`) и
передаёт его вниз. MCP runtime всегда передаёт `false`.

## Безопасность

- Значения не логируются, не входят в результаты команд, JSON-вывод и ошибки.
  В ошибках есть только имена.
- Файл env создаётся с `0600`. Если существующий файл доступен группе или другим
  пользователям, права исправляются до `0600`.
- `UserEnvironment` перезаписывает только свои строки и не трогает другие
  переменные пользователя.
- Значение хранится открытым текстом, как и любая переменная окружения. Это
  отмечено в пользовательской документации.

## Тесты

- Адаптеры (`src/packages/core/test/`, рядом с существующими тестами адаптеров):
  - Qwen и GigaCode: разбор `settings`, отсутствие `settings`, некорректный
    `envVar`;
  - Claude: встроенные `mcpServers` и путь к `.mcp.json`; пропуск
    `${VAR:-x}`, `CLAUDE_*`, `${user_config.*}`; дубли.
- `UserEnvironment` на временном `HOME` и `XDG_CONFIG_HOME`:
  - экранирование;
  - права `0600`;
  - маркер профиля добавляется один раз;
  - обновление существующего значения.

  Windows-ветка проверяется с fake process без вызова настоящего `reg`.
- `ExtensionEnvironment` с fake prompt:
  - объединение по имени;
  - уже заданные переменные не запрашиваются;
  - `interactive: false` → `EXTENSION_ENV_MISSING` без записи;
  - отмена → `EXTENSION_ENV_CANCELLED` без записи;
  - значения отсутствуют в тексте ошибок.
- Интеграция:
  - `ProjectSetup.connect` с fake adapter: ввод → запись → `connectSelected`;
    без TTY ни одна Extension не подключена;
  - `extension connect` и `plugin connect` вызывают тот же шаг с узким набором.

Тесты изолируют `HOME`, `XDG_CONFIG_HOME`, `SHELL` и восстанавливают
`process.env`. Проверки: `npm run check`, `git diff --check`.

## Документация

- `docs/user/join-project.md`, раздел «Что делает connect»: ввод переменных,
  где они хранятся, перезапуск агента, поведение через MCP.
- `docs/extensions/development.md`: как объявить переменные: `settings` для Qwen
  и GigaCode, `${VAR}` в MCP-конфиге для Claude.
- `docs/user/troubleshooting.md`: `EXTENSION_ENV_MISSING`,
  `EXTENSION_ENV_CANCELLED`, `USER_ENVIRONMENT_WRITE_FAILED`.

## Ограничения

- Тесты используют fake нативные CLI. На реальных Qwen и GigaCode не проверено,
  что `extensions install` с `settings` и закрытым stdin не задаёт вопрос. По
  исходному коду Qwen значение `undefined` пропускается, а MCP-сервер берёт `${VAR}`
  из `process.env`.
- Агенты, запущенные из GUI на macOS, не читают профиль shell. Для них нужен
  запуск из терминала. Это отмечено в документации.
