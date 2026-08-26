# Конфигурация `openspec-orch.yaml`

Файл находится в корне Store и имеет строгий формат `version: 1`. Core перечитывает
его перед операциями. Неизвестные поля, старые `agent`/`handoffs`/`extensions`,
multi-role Repository и ссылки на необъявленный Plugin отклоняются как
`CONFIG_INVALID`.

## Полный пример

```yaml
version: 1
strict: true

agents:
  - qwen

plugins:
  - id: openspec-graph
    source: "@openspec-orch/plugin-openspec-graph@1.0.0"
    required: true
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

Обычный пользователь не обязан редактировать YAML вручную. `init`, Plugin lifecycle
и Project Template поддерживают declarations/bindings. Ручное изменение должно
сохранять все инварианты ниже.

## Верхнеуровневые поля

| Поле | Обязательно | Назначение |
|---|---:|---|
| `version` | да | Только целое значение `1`; скрытой миграции нет |
| `strict` | нет | Project default Git-проверок; отсутствие означает `true` |
| `agents` | нет | Уникальные Agent ID, зарегистрированные успешным `init` |
| `plugins` | нет | Точные Plugin declarations |
| `repositories` | да | Ровно один Store и минимум один Code Repository для `connect` |

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

## `agents`

Список фиксирует агентов, для которых Plugin Agent contribution может установить MCP
и инструкции. Он не заменяет mapping Project Template. Base Template поддерживает
`qwen`, `gigacode` и `claude`; custom Template может определить другой mapping.

Проект без зарегистрированного Agent не может установить Plugin с обязательной Agent
integration: операция завершается без частичной установки.

## `plugins`

Каждая declaration содержит:

| Поле | Назначение |
|---|---|
| `id` | Kebab-case Plugin ID, используемый в CLI и bindings |
| `source` | Точная package identity, выбранная при `plugin init` |
| `required` | `true`, если ID входит в `requires.plugins` активного Template |

Declaration не связывает Plugin с Repository. Binding хранится в
`repositories[].plugins`. Один Plugin может быть связан с несколькими Repositories,
а один Repository — с несколькими Plugins.

`required: true` блокирует `plugin remove`. Сначала примените Template без этой
зависимости, затем отключите bindings и только после этого удаляйте Plugin.

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

Для уже существующего Store используйте `connect`, а не повторный `init`.
