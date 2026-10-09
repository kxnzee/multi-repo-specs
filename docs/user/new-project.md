# Создание нового проекта

Этот документ для того, кто впервые заводит Store для продукта. Ниже описана
настройка из терминала; то же самое можно сделать [через агента](setup-via-agent.md). Если Store уже
есть, используйте [подключение к существующему проекту](join-project.md).

Перед началом выполните [установку](installation.md).

## 1. Выберите Store ID и каталог

Store ID задаётся один раз, например `specs`. Он записывается в
`<workspace>/specs/openspec-orch.yaml` и `<workspace>/specs/.openspec-store/store.yaml`, попадает в Git и должен
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
  --agent gigacode \
  --store-remote ssh://git.example.org/product/specs.git \
  --store-branch main \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main \
  --repo-description "frontend=Личный кабинет клиента. React и TypeScript"
```

| Параметр | Обязателен | Назначение |
|---|---|---|
| `--store` | да | Store ID |
| `--agent` | да | `gigacode` (или `claude`, `qwen`). Агент фиксируется для Store |
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

Откройте GigaCode из `<workspace>/specs/` и заполните `<workspace>/specs/openspec/context/`:
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

## Альтернатива: через агента

Те же шаги можно выполнить, попросив об этом GigaCode: агент создаст Store и
подключит проект через MCP. Порядок описан в
[настройке через агента](setup-via-agent.md#2-новый-проект).
