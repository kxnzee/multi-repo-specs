# Техническая обвязка SDD

`harness/` — автономная техническая реализация пользовательских команд SDD. Код из этой директории не является нормативным описанием процесса: правила процесса находятся в `docs/`, а рабочее состояние проекта — в корневых `openspec/` и `.qwen/`.

## Первый запуск

Требуются Node.js `20+` и OpenSpec `1.7.0`; поддерживаются macOS, Linux и Windows. Из корня репозитория выполните:

```bash
cd harness
npm install
npm link
cd ..
sdd --help
```

После успешной проверки интерфейс командной строки можно вызывать из корня и других каталогов:

```bash
sdd init --help
```

Регистрация выполняется один раз для каждой активной версии Node.js. После переключения версии через NVM повторите `npm link` из директории `harness/`.

## Создание центрального проекта

`sdd init` выполняется один раз из чистого корня подготовленного центрального Git-репозитория с `origin` и текущей основной веткой:

```bash
sdd init --store payments-specs \
  --repo ui=https://example.test/ui.git#main \
  --repo api=https://example.test/api.git#main
```

Команда проверяет OpenSpec `1.7.0`, создаёт Store через официальный `openspec store setup`, устанавливает оригинальный профиль `core` и раскладывает SDD skeleton. Существующие SDD/OpenSpec-файлы и нечистое рабочее дерево блокируют запуск; режима перезаписи нет. Повторный вызов для уже существующей Store metadata не меняет файлы и направляет пользователя к `sdd connect`.

Запуск без регистрации в `PATH`:

```bash
node harness/bin/sdd.js init --store payments-specs
```

## Подключение рабочей машины

После клонирования центрального Store Repository выполните из его корня:

```bash
sdd connect
```

Для нестандартного расположения каталогов задайте workspace явно:

```bash
sdd connect --workspace /absolute/path/to/workspace
```

Команда передаёт Store identity официальным `store register` и `doctor`, затем загружает все записи `role: code` из `sdd.yaml` в `<workspace>/src/<repository-id>`. Существующие checkout не обновляются и не перезаписываются: проверяются только их `origin`, ветка и чистота.

Если в Code Repository отсутствует единственный допустимый `openspec/config.yaml`, команда создаёт pointer `store: <store-id>` и возвращает `needs_setup_pr`. Она не делает commit, push или PR. После принятия setup PR обновите checkout и повторите `sdd connect`.

`sdd` не повторяет внутреннюю валидацию OpenSpec: ошибки `store register` и `doctor` возвращаются пользователю напрямую. `connect_status: ready` означает, что адаптер завершил свою часть без `needs_setup_pr`; проектный шаг всё равно требует принятого initialization PR.

## Explore запроса

После принятого шага 00 запустите из Spec Root или его вложенного каталога:

```bash
sdd explore --ticket PAY-412
```

Команда проверяет OpenSpec, оригинальный agent action `/opsx-explore`, `sdd.yaml`, существующие Changes и правило `.sdd/checkouts/` в `.gitignore`. Затем она интерактивно предлагает выбрать Code Repositories. Пустой подтверждённый выбор запускает Explore только по нормативному контексту и Master Specs центрального репозитория с `role: store`.

Выбранные репозитории клонируются с их `default_branch` во временный каталог и атомарно публикуются только для чтения в `.sdd/checkouts/explore/<ticket>/`. При любой ошибке итоговый workspace не остаётся. Credential предоставляет внешний Git credential helper; команда не принимает и не сохраняет секреты.

После успешной подготовки CLI печатает готовую строку для Qwen Code. Она вызывает оригинальный action OpenSpec и передаёт ему ticket, абсолютные пути, выбранные ревизии, read-only-границы и обязательные разделы результата. Скопируйте всю строку, начинающуюся с:

```text
/opsx-explore PAY-412. Это Explore шага 01 SDD. ...
```

`sdd explore` не изменяет содержимое `opsx-explore.md`: файл принадлежит OpenSpec и может штатно обновляться вместе с ним. Если action отсутствует, восстановите его через `openspec update --force` и повторите подготовку. `sdd explore` требует TTY; флага для неинтерактивного выбора в первой реализации нет. Переданная дополнительная инструкция запрещает создавать Change, `state.yaml`, ветку, коммит или PR и читать Jira по API.

Если в будущем аргумента оригинального action станет недостаточно, отдельная ревизия процесса может добавить `/sdd-explore`. Она должна жить в пространстве имён `sdd-*` и не перезаписывать `opsx-*`; текущая реализация такой команды не создаёт.

## Границы

- `bin/` — минимальные точки входа командной строки.
- `config/index.js` — строгий разбор Store identity и реестра `sdd.yaml`.
- `connect/index.js` — техническая логика `sdd connect`.
- `explore/index.js` — проверки и подготовка read-only workspace шага 01.
- `init/index.js` — техническая логика `sdd init`.
- `shared/` — единый безопасный запуск внешних команд.
- `init/skeleton/` — декларативный версионируемый каркас шага 00 без исполняемой логики.
- `test/` — тесты технической обвязки, не входящие в публикуемый пакет.

Суффикс `.template` у файла каркаса удаляется при установке. Например, `.gitignore.template` становится `.gitignore`; это позволяет npm включить файл в пакет.

`init/index.js` выполняет короткую Git-проверку, вызывает официальные Store/init API OpenSpec и раскладывает каркас. `connect/index.js` вызывает официальные register/doctor, создаёт workspace, загружает Code Repositories и проверяет project pointer. Внутренние правила OpenSpec адаптер не дублирует. Содержимое контекста, схемы, шаблонов и команд агента задаётся файлами `init/skeleton/`.

## Разработка

Из корня репозитория:

```bash
npm --prefix harness run check
npm --prefix harness test
node harness/bin/sdd.js --help
```
