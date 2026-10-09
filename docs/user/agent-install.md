# Установка Orchestrator силами агента

Этот документ — инструкция для ИИ-агента. Есть два способа запуска.

**Из чекаута Orchestrator (проще всего).** Человек клонирует только Orchestrator
в каталог будущего воркспейса, открывает в нём клиент агента и вызывает команду:

```bash
git clone https://github.com/kxnzee/multi-repo-specs
cd multi-repo-specs
claude
```

```text
/setup-workspace
```

В чекауте команда `/setup-workspace` лежит в `.claude/commands`, `.qwen/commands` и
`.gigacode/commands`. Эти каталоги относятся только к чекауту Orchestrator: их нет
в `templates/` и `extensions/`, поэтому `init` и `connect` не копируют команду в
Store и репозитории кода, а в npm-пакет она не входит. Любой другой агент можно
попросить: «выполни `docs/user/agent-install.md`» (раздел «Установка силами агента»
в `AGENTS.md`). Корнем воркспейса считается родительский каталог чекаута, шаг клонирования
Orchestrator пропускается.

**Из корня воркспейса.** Человек запускает агента в пустом или подготовленном
каталоге и пишет:

```text
Прочитай docs/user/agent-install.md в репозитории
https://github.com/kxnzee/multi-repo-specs и выполни её: установи Orchestrator,
подключи репозиторий спецификаций и агента. Параметры: <см. шаг 1>.
```

Агент клонирует Orchestrator на шаге 2 и продолжает по локальной копии
`multi-repo-specs/docs/user/agent-install.md`.

## Правила для агента

- Рабочий каталог на старте — корень воркспейса `<workspace>`. Не запускай `init`,
  `connect` и `agent setup` внутри каталога `multi-repo-specs` (исходники
  Orchestrator) и внутри репозиториев кода.
- Не придумывай параметры. Недостающие значения из шага 1 спроси у человека и
  дождись ответа.
- Не вводи и не запрашивай пароли, токены и ключи. Если Git или клиент агента
  требует авторизации, остановись и сообщи, какая команда и какой хост её просит.
- Не используй `sudo`, `--force`, `git reset --hard`, удаление каталогов и
  `npm link` без явного разрешения. Не меняй существующие каталоги и файлы
  пользователя; если целевой каталог занят, остановись и спроси.
- Не коммить и не пушь в репозитории без просьбы человека. Сообщи, какие файлы
  `connect` создал или изменил.
- Каждый шаг проверяй по его критерию «Готово, когда». Ошибку не обходи, а
  покажи человеку: команду, код возврата и вывод.
- Секреты и содержимое пользовательских конфигураций агента в отчёт не включай.

## Итоговая раскладка

```text
<workspace>/
├── multi-repo-specs/   # Orchestrator (клон, npm ci)
├── specs/              # Store: репозиторий спецификаций
└── src/                # Code Repositories (клонирует connect)
    ├── frontend/
    └── backend/
```

Имя каталога Store совпадает с его Store ID (`<workspace>/<store-id>`). Ниже он
записан как `specs`.

## Шаг 1. Соберите параметры

Спроси у человека всё, что не передано в задаче:

| Параметр | Пример | Комментарий |
|---|---|---|
| `ORCH_REPO` | `https://github.com/kxnzee/multi-repo-specs` | Git-адрес Orchestrator |
| `ORCH_REF` | тег или коммит | Согласованная версия. Не вершина ветки, если версию фиксирует команда |
| `STORE_ID` | `specs` | Стабильный ID Store. Для существующего Store — тот, что принят в команде |
| `STORE_REMOTE` | `ssh://git.example.org/product/specs.git` | Git-адрес Store. Пусто — создать новый локальный Store |
| `STORE_REF` | `main` | Ветка или ревизия существующего Store |
| `AGENT` | `claude`, `qwen` или `gigacode` | Агент, который будет работать с проектом |
| `CODE_REPOS` | `frontend=ssh://…/frontend.git#main` | Только для нового Store: репозитории кода в виде `id=remote#branch` |
| `TEMPLATE` | `default` | Только для нового Store; по умолчанию `default` |
| `PLUGINS` | `openspec-graph change-tracking` | Какие bundled Plugins подключить; по умолчанию не подключать |

Определи режим: **существующий Store** (задан `STORE_REMOTE`, Store уже принят
командой) или **новый Store**. Для существующего Store `init` не выполняется.

## Шаг 2. Проверьте окружение и подготовьте Orchestrator

```bash
node --version      # нужен 22.16.0 или новее
npm --version
git --version
<agent-cli> --version   # claude, qwen или gigacode, по выбранному AGENT
```

Если Node.js старше 22.16.0, Git или клиент агента отсутствует, остановись и
сообщи, что установить. Клиент агента и вход в его аккаунт — работа человека.

Если сессия уже открыта в чекауте Orchestrator, пропусти `git clone` и `git checkout`
(при необходимости сверь `git rev-parse HEAD` с `ORCH_REF`) и выполни остальное.

```bash
git clone "$ORCH_REPO" multi-repo-specs
cd multi-repo-specs
git checkout "$ORCH_REF"
npm ci
npm run check:environment
```

**Готово, когда:** `check:environment` завершился успешно и
`node src/bin/openspec-orch.js --help` печатает список команд.

## Шаг 3. Сделайте команды доступными

Orchestrator требует команды `openspec` и `openspec-orch` в `PATH` процесса, где
они запускаются. `npm ci` ставит OpenSpec 1.11.0 локально в `node_modules/.bin`,
поэтому глобальные установки не нужны. Предпочитай этот вариант:

```bash
export ORCH_DIR="$(pwd)"
export PATH="$ORCH_DIR/node_modules/.bin:$PATH"
alias openspec-orch="node $ORCH_DIR/src/bin/openspec-orch.js"   # только для этого shell
```

Алиасы не работают в неинтерактивном shell. Тогда используй полный вызов
`node "$ORCH_DIR/src/bin/openspec-orch.js" …` вместо `openspec-orch` во всех шагах
ниже. Переменные окружения не сохраняются между отдельными вызовами shell:
задавай `PATH` в каждой команде или объединяй команды одной строкой.

Глобальную ссылку `npm link` и `npm install --global` делай только если человек
явно разрешил.

**Готово, когда:** `openspec --version` печатает `1.11.0`, а
`node "$ORCH_DIR/src/bin/openspec-orch.js" --version` печатает версию.

## Шаг 4. Получите Store

Вернись в корень воркспейса.

### Существующий Store

```bash
cd <workspace>
git clone "$STORE_REMOTE" "$STORE_ID"
cd "$STORE_ID"
git checkout "$STORE_REF"
openspec store list
```

Если `STORE_ID` уже закреплён в локальном реестре OpenSpec за другим путём, остановись
и сообщи об этом: не меняй идентичность Store.

### Новый Store

Перед созданием убедись, что каталог `<workspace>/<STORE_ID>` не существует или пуст.

```bash
mkdir -p <workspace>/"$STORE_ID"
cd <workspace>/"$STORE_ID"
openspec-orch init . \
  --store "$STORE_ID" \
  --agent "$AGENT" \
  --template "${TEMPLATE:-default}" \
  --repo <id>=<remote>#<branch>      # повтори для каждого элемента CODE_REPOS
```

Добавь `--store-remote`, `--store-branch`, `--repo-description` только если человек
их передал. Если `init` вернул `needs_recovery` или любую ошибку, остановись: повторный
`init` не является ремонтом (см. [восстановление](installation-and-updates.md#восстановление-после-сбоя)).

**Готово, когда:** в корне Store есть `openspec-orch.yaml`.

## Шаг 5. Подключите репозитории

Из корня Store:

```bash
openspec-orch connect --workspace <workspace>
```

`connect` клонирует отсутствующие Code Repositories в `<workspace>/src/`, доставляет
в них команды и skills агента и подключает Extensions Store. Он может обратиться к
Git-хостам. Если он запросил авторизацию, остановись и скажи человеку, какую.

Команда может создать файлы в репозиториях кода (результат `files_changed`). Не
коммить их сам: перечисли человеку `git status --short` каждого репозитория.

**Готово, когда:** `connect` завершился без ошибок, а каталоги всех репозиториев
из реестра появились в `<workspace>/src/`.

## Шаг 6. Подключите агента

```bash
openspec-orch agent setup --agent "$AGENT"
openspec-orch agent status --agent "$AGENT"
```

Шлюз ставится в пользовательскую область клиента агента и общий для всех его
проектов. Если `agent setup` уже был выполнен ранее, `--refresh` добавляй только
когда `status` показывает устаревшую установку.

**Готово, когда:** `agent status` сообщает, что шлюз установлен и актуален.

## Шаг 7. Подключите Plugins (необязательно)

Только для `PLUGINS`, переданных человеком. Из корня Store:

```bash
openspec-orch plugin init --plugin <plugin-id>
openspec-orch plugin connect <plugin-id> --repo <repository-id>   # для нужных репозиториев
openspec-orch plugin status --plugin <plugin-id>
```

Список и области действия — в [каталоге плагинов](../plugins/README.md). Изменения
`openspec-orch.yaml`, `package.json` и `package-lock.json` относятся к Store: покажи
их `git diff`, не коммить.

## Шаг 8. Проверьте результат

```bash
openspec-orch doctor
openspec-orch doctor --json    # сохрани вывод, если есть замечания
```

**Готово, когда:** `doctor` не сообщает ошибок. Для каждого замечания приведи код,
причину и команду из раздела «Дальше», но выполняй такую команду только если она
входит в этот документ; иначе спроси человека.

## Шаг 9. Отчёт человеку

Сообщи:

1. Версию Orchestrator (`ORCH_REF`), Node.js, OpenSpec и клиента агента.
2. Что создано или склонировано, с абсолютными путями.
3. Какие файлы изменены в Store и Code Repositories и не закоммичены.
4. Результат `agent status` и `doctor`. Не пиши «проверено», если шаг пропущен или
   заблокирован: назови блокер.
5. Ручные действия: перезапустить клиент агента (шлюз виден только в новой сессии)
   и открыть сессию Planning из корня Store.

Дальнейшая работа: planning Change запускается из `<workspace>/<STORE_ID>`,
реализация — отдельной сессией в `<workspace>/src/<repository-id>`. См.
[быстрый старт](quick-start.md#быстрый-старт) и
[сценарий Change](../templates/default.md).

## Типичные остановки

| Ситуация | Действие |
|---|---|
| Node.js старше 22.16.0 | Остановиться, попросить человека обновить Node |
| Нет доступа к npm registry при `npm ci` | Сообщить хост и ошибку; не подменять зависимости |
| Нет прав на клонирование Store или репозиториев кода | Показать адрес и ошибку; не вводить учётные данные |
| `STORE_ID` занят другим checkout | Остановиться; не менять идентичность Store |
| `AGENT_PACK_CONFLICT` при `connect` | Показать путь; `connect` намеренно не перезаписывает файл |
| Любой другой код ошибки | Найти в [таблице восстановления](installation-and-updates.md#симптомы-и-действия) и сообщить человеку |
