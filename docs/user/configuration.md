# Конфигурация `openspec-orch.yaml`

Файл находится в корне Store и имеет строгий формат `version: 2`. Core перечитывает
его перед операциями. Неизвестные поля, старые `agents`/`handoffs`,
multi-role Repository и ссылки на необъявленный Plugin отклоняются как
`CONFIG_INVALID`.

## Полный пример

```yaml
version: 2
strict: true

template:
  id: base

agent:
  id: qwen

extensions:
  - id: openspec-base
    source: bundled:openspec-base
  - id: superpowers
    source: bundled:superpowers

plugins:
  - id: openspec-graph
    source: "@openspec-orch/plugin-openspec-graph@1.0.0"
  - id: codegraph
    source: "@openspec-orch/plugin-codegraph@1.0.0"

repositories:
  - id: specs
    roles: [store]
    remote: ssh://git.example.org/product/specs.git
    default_branch: main
    plugins:
      - openspec-graph

  - id: frontend
    roles: [code]
    remote: ssh://git.example.org/product/frontend.git
    default_branch: main
    plugins:
      - codegraph
```

Обычный пользователь не обязан редактировать YAML вручную. `init` управляет базовой
Project configuration и standalone Extensions, а Plugin lifecycle — declarations и
bindings. Project Template только копирует объявленные assets. Ручное изменение
должно сохранять все инварианты ниже.

## Верхнеуровневые поля

| Поле | Обязательно | Назначение |
|---|---:|---|
| `version` | да | Только целое значение `2`; скрытой миграции нет |
| `strict` | нет | Project default Git-проверок; отсутствие означает `true` |
| `template` | да | Identity выбранного copy-only Template |
| `agent` | да | Единственный Agent, выбранный независимо от Template |
| `extensions` | нет | Упорядоченные standalone Extension declarations |
| `plugins` | нет | Точные Plugin declarations |
| `repositories` | да | Ровно один Store и ноль или несколько Code Repository |

## Strict и relaxed mode

В strict mode Core:

- проверяет Git identity, origin и default branch;
- требует чистый checkout с оговоренными исключениями;
- клонирует отсутствующие Code Repositories;
- использует полный Git SHA;
- запоминает явно выбранный workspace локально.

`--no-strict` ослабляет текущий вызов. Для `init` он также сохраняет
`strict: false` как project default. Если default уже `false`, обратного CLI-флага,
который включит strict только на один вызов, нет.

В relaxed mode Core не клонирует и не выполняет Git pinning; существующие каталоги
`<workspace>/src/<repository-id>` обязательны, а revision обозначается `unpinned`.

## `template`, `agent` и `extensions`

`template.id` фиксирует identity применённого Template, а `agent.id` — единственного
Agent Store. Они выбираются независимо. `extensions[]` сохраняет порядок подключения;
каждая запись содержит только `id` и точно совпадающий `source: bundled:<id>`.
Version, revision и абсолютный путь в Store не записываются.

Project без Template или Agent недопустим.

`openspec-base` и `superpowers` — independently delivered bundled Extensions. Template
не копирует их payload, но может объявить required Extensions. Bundled профили:
`base → openspec-base`, `superspec → superpowers`. Поэтому init показывает совместимую
связку, добавляет requirement автоматически и отклоняет `--no-extensions` для обоих
bundled Template. Дополнительные Extensions по-прежнему выбираются явно.

Порядок задаётся повторяемыми флагами `init --extension <id>`. `connect` последовательно
передаёт выбранные standalone Extension и contributions всех сохранённых Plugin
bindings нативному CLI Agent. `disconnect` локально отключает их в обратном порядке,
не меняя Store config. Отдельного Extension CLI в Orchestrator нет.

## `plugins`

Каждая declaration содержит:

| Поле | Назначение |
|---|---|
| `id` | Kebab-case Plugin ID, используемый в CLI и bindings |
| `source` | Точная package identity, выбранная при `plugin init` |

Declaration не связывает Plugin с Repository. Binding хранится в
`repositories[].plugins`. Один Plugin может быть связан с несколькими Repositories,
а один Repository — с несколькими Plugins.

Удаление Plugin блокируется только существующими Repository bindings.

## `repositories`

| Поле | Назначение и ограничения |
|---|---|
| `id` | Уникальный lowercase kebab-case identifier; используется в CLI, Graph и Cycle |
| `roles` | Singleton `[store]` или `[code]`; ровно один Store |
| `remote` | Сетевой Git URL без встроенных HTTP(S) credentials; local absolute path и `file://` запрещены |
| `default_branch` | Ветка, ожидаемая strict `connect` и repository status |
| `plugins` | Уникальные ID из верхнеуровневого `plugins` |

Store владеет Specs, Changes и Cycle Records. Только Code Repositories могут входить
в Cycle. Repository ID не обязан совпадать с именем Git repository, но локальный
standard layout использует его как имя каталога в `workspace/src/`.

## Локальные и tracked данные

| Путь | Назначение | Git |
|---|---|---|
| `openspec-orch.yaml` | Project configuration | tracked |
| `.openspec-store/store.yaml` | Identity OpenSpec Store | tracked |
| `.openspec-orch/changes/*.json` | Cycle Records | tracked |
| `.openspec-orch/state.json` | Последний strict workspace | local/ignored |
| `.openspec-orch/plugins/<id>/state.json` | Versioned Plugin state | local/ignored |
| `.openspec-orch/cache/plugin-runtimes/<id>/` | External Plugin runtime | local/ignored |

Не удаляйте отдельные части `.openspec-store` или `.openspec-orch` для «починки».
Сначала используйте read-only status и точную recovery-инструкцию ошибки. Поврежденный
Plugin state не перезаписывается автоматически.

## Нестандартный workspace

Порядок выбора:

1. явный `--workspace`;
2. локально сохраненный путь;
3. родитель Store, если имя каталога равно Store ID;
4. безопасная остановка с инструкцией.

После перемещения:

```bash
openspec-orch connect --workspace /new/absolute/path/to/workspace
```

Для локального подключения компонентов уже существующего Store используйте `connect`.
Повторный `init` нужен только для явного изменения desired-набора standalone
Extensions через `--extension` или `--no-extensions`; без этих флагов текущий набор
сохраняется.
