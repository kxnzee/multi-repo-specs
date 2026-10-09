# Создание нового проекта

Этот документ для того, кто впервые заводит Store для продукта. Если Store уже
есть, используйте [подключение к существующему проекту](join-project.md).

Перед началом выполните [установку](installation.md).

## 1. Выберите Store ID и каталог

Store ID задаётся один раз, например `specs`. Он записывается в
`openspec-orch.yaml` и `.openspec-store/store.yaml`, попадает в Git и должен
совпадать у всех участников. Позже его не меняют.

Проверьте, что ID не занят на этой машине, и создайте пустой каталог:

```bash
openspec store list
mkdir -p /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs
```

На одной машине один Store ID может указывать только на один каталог.

## 2. Выберите Template

| Template | Когда выбирать |
|---|---|
| `default` | Обычная работа: доработки продукта в одном или нескольких репозиториях кода. См. [Template default](../templates/default.md) |
| `initiative` | Общая инициатива нескольких команд без управления их разработкой. См. [Template initiative](../templates/initiative.md) |

Без `--template` используется `default`. Свой Template передаётся абсолютным путём,
см. [создание дополнений](creating-addons.md).

## 3. Выполните init

```bash
openspec-orch init . \
  --store specs \
  --agent qwen \
  --store-remote ssh://git.example.org/product/specs.git \
  --store-branch main \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main \
  --repo-description "frontend=Личный кабинет клиента. React и TypeScript"
```

| Параметр | Обязателен | Назначение |
|---|---|---|
| `--store` | да | Store ID |
| `--agent` | да | `claude`, `qwen` или `gigacode`. Агент фиксируется для Store |
| `--repo id=remote#branch` | нет | Репозиторий кода; повторяется для каждого |
| `--repo-description id=text` | нет | Описание репозитория для агента: назначение, технологии, границы |
| `--store-remote`, `--store-branch`, `--store-description` | нет | Сведения о самом Store |
| `--template` | нет | ID встроенного Template или путь к своему |
| `--extension`, `--no-extensions` | нет | Дополнительные standalone Extensions или явный пустой список |

Обязательные Extensions выбранного Template добавляются автоматически. Для
`default` это `project-context`, `spec-driven-extended` и `superpowers`.

Вместо `.` можно передать абсолютный путь к Store и запускать команду из
другого каталога. В терминале `openspec-orch init` без флагов запускает
интерактивный выбор; вне терминала `--store` и `--agent` обязательны.

Повторный `init` не обновляет и не ремонтирует существующий Store. Что делать,
если `init` прервался, написано в [диагностике](troubleshooting.md).

## 4. Подключите репозитории и проверьте

```bash
openspec-orch connect
openspec-orch doctor
```

`connect` клонирует репозитории кода в `<workspace>/src/` и доставляет в них
команды OpenSpec и навыки агента. Подробно `connect` разобран в
[подключении к проекту](join-project.md#что-делает-connect).

## 5. Заполните бизнес-контекст

Откройте сессию агента из корня Store и заполните `openspec/context/`:
назначение продукта, термины, участников, процессы и ограничения. Команды и
правила описаны в [бизнес-контексте](project-context.md).

## 6. Подключите нужные плагины

Плагины необязательны. Выберите нужные в [каталоге плагинов](../plugins/README.md)
и подключите по [общему порядку](../plugins/operations.md). Например:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
```

После подключения перезапустите агента.

## 7. Опубликуйте Store

Store хранится в обычном Git-репозитории. Закоммитьте созданные файлы и отправьте их в
remote, указанный в `--store-remote`, по процессу команды. С этого момента
участники подключаются по [инструкции для команды](join-project.md).

Изменения в репозиториях кода, которые сделал `connect` (команды OpenSpec, навыки,
указатель на Store), тоже сохраняются по процессу команды.

Следующий шаг: [первый Change](change/README.md).

## Альтернатива: инициализация из сессии агента

Ту же инициализацию можно выполнить через MCP-инструменты. Они работают только
в каталоге, из которого открыта сессия агента.

1. Установите [шлюз агента](installation.md#4-шлюз-агента) и перезапустите агента.
2. Откройте новую сессию агента из пустого каталога Store.
3. Попросите агента вызвать `get_setup_context` с пустым объектом и проверьте:
   - `cwd` совпадает с корнем Store;
   - в `constraints` указаны `fixed_cwd: true` и `target_role: store`;
   - нужные агент и Template есть в `choices.agents[].id` и `choices.templates[].id`;
   - текущий каталог не входит в `constraints.forbidden_targets`.
4. Если `cwd` неверный, не продолжайте: закройте сессию и откройте её в корне
   Store. Сменить каталог аргументом нельзя; вызов из неверного каталога вернёт
   `INIT_TARGET_INVALID`.
5. Вызовите `initialize_project`:

```json
{
  "store_id": "specs",
  "agent_id": "qwen",
  "template_id": "default",
  "store_remote": "ssh://git.example.org/product/specs.git",
  "store_default_branch": "main",
  "repositories": [
    {
      "repository_id": "frontend",
      "remote": "ssh://git.example.org/product/frontend.git",
      "default_branch": "main",
      "description": "Личный кабинет клиента. React и TypeScript."
    }
  ]
}
```

Обязательны только `store_id` и `agent_id`. В `repositories` перечисляются только
репозитории кода. Необязательный массив `extensions` добавляет standalone
Extensions. Свой путь к Template и `--workspace` через MCP не поддерживаются.

6. Затем `connect_project` с пустым объектом и `get_doctor_report`. Перед
   `connect_project` подтвердите клонирование репозиториев.

Дальше выполните шаги 5–7 выше.
