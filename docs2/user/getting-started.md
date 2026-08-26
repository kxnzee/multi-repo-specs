# Начало работы

## Требования

- Node.js `20.19.0` или новее;
- npm и Git;
- доступный в `PATH` OpenSpec CLI;
- Git remote для Store и каждого Code Repository.

Core проверяет, что `openspec --version` возвращает semantic version. Minimum и exact
pin не заданы, поэтому совместимость конкретной версии подтверждается отдельно в
вашем окружении.

## Создание нового проекта

Target должен заранее существовать, быть обычным каталогом и корнем чистого Git
Repository с настроенным `origin` и выбранной веткой. `init` не создает каталог и не
инициализирует Git. Для уже инициализированного Store используйте `connect`, а не
повторное создание проекта.

Пример Store `specs` с двумя Code Repositories:

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main

cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch repository status
```

`init` создает Store, вызывает штатный OpenSpec init с adapter выбранного агента,
применяет Base или явно переданный Project Template, записывает
`openspec-orch.yaml` и устанавливает required Plugins Template. Команда не клонирует
Code Repositories: это делает последующий `connect` в strict mode.

При `--no-strict` проект получает `strict: false`. Тогда `connect` не клонирует и не
проверяет Git identity/remote/branch/clean state; каталоги
`<workspace>/src/<repository-id>` должны существовать заранее.

## Что появляется в Store

```text
openspec-orch.yaml
.openspec-store/store.yaml
openspec/
├── config.yaml
├── schemas/base-v1/
├── context/
├── specs/
└── changes/
<provider-specific commands, skills и instructions>
```

Base Template применяется только во время `init`. Установленные файлы становятся
частью Store и автоматически не обновляются при изменении исходного Template.

## Подключение workspace

Обычная раскладка определяется по родителю Store. Для нестандартного расположения
задайте workspace явно:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

В strict mode путь запоминается локально в `.openspec-orch/state.json`. При переносе
workspace повторите команду с новым абсолютным путем. `connect` проверяет Store,
регистрирует его в OpenSpec, создает или проверяет Code Repository checkout и
OpenSpec pointer. Существующий checkout не получает `pull`, `checkout` или `reset`.

## Первичное подключение OpenSpec Graph

Base Template устанавливает `openspec-graph` как required Plugin, но binding и индекс
создаются явно:

```bash
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch graph build
openspec-orch graph status --json
```

`plugin connect` только создает binding. `graph build` выполняется отдельно и требует
валидные OpenSpec topology inputs. Если в Store уже есть Intake-only или
Proposal-only Change без валидных Delta Specs, завершите Planning до первого build.

## Минимальная проверка готовности

```bash
openspec-orch repository status
openspec-orch plugin status --plugin openspec-graph
openspec-orch graph status --json
```

Ожидаемый Graph status перед `impact`, `inspect`, `check-scope` или `view`:
`state: ready` и `authoritative: true`. При `stale` или `unavailable` выполните
`next_command` из JSON и повторите status. `invalid` означает ошибку входных данных,
которую нельзя обходить last-known-good индексом.

## Следующий шаг

- для личной работы — [поток одного человека](solo-flow.md);
- для распределения ответственности — [командный поток](team-flow.md);
- для существующего или нестандартного проекта — [конфигурация](configuration.md).
