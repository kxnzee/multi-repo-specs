# OpenSpec Graph Plugin

Store-only Plugin, который автоматически строит граф текущего OpenSpec Store. Граф
показывает структуру Store, зарегистрированные Code Repositories, Master Specs,
активные и архивные Changes, Delta Specs и связи Repository–Master Spec.

OpenSpec Graph является компиляцией Store, а не отдельной базой знаний. Агент не
заполняет и не обслуживает граф, ручная graph metadata отсутствует.

## Назначение и границы

Plugin отвечает на два вопроса:

1. Из каких OpenSpec-артефактов сейчас состоит Store?
2. Какие Repository были явно сопоставлены с какими capabilities через активные или
   архивные Changes?

Plugin не анализирует исходный код Repository и не доказывает, что capability
реализована. За навигацию по файлам, символам и runtime-зависимостям отвечает
CodeGraph. OpenSpec Graph не создаёт связи `implemented_by`, `calls`, `depends_on`,
Repository–Repository или Master Spec–Master Spec.

## Как работает компиляция

Каждый `graph inspect` и `graph view` выполняет полный независимый проход:

```text
openspec-orch.yaml + openspec/**
              │
              ▼
     обход и строгий парсинг
              │
              ▼
      проекция nodes/edges
              │
              ▼
 diagnostics + status + summary
              │
              ├── openspec validate --all --strict
              │
              ▼
        immutable Graph Report
              │
              ├── graph inspect
              └── graph view
```

Последовательность работы:

1. Orchestrator передаёт Plugin контекст Store, Store ID и зарегистрированные Code
   Repositories.
2. Package-owned compiler сканирует стандартные пути `openspec/` и
   `openspec-orch.yaml`. Порядок файлов и результата стабилизируется сортировкой.
3. Структура каталогов создаёт ноды Store, Master Spec, Change и Delta Spec.
4. Стандартные Delta headings создают связи `affects` и `changes`.
5. Таблица Repository Impact создаёт точные `changes_in` и `linked`.
6. Компилятор добавляет diagnostics, вычисляет `status` каждой затронутой ноды и
   связи, а затем формирует summary.
7. Ошибка строгой OpenSpec validation добавляется в тот же report как
   `OPENSPEC_VALIDATION_FAILED`, не уничтожая уже построенную частичную модель.

Граф не читает и не пишет persisted index, digest, freshness state или
last-known-good snapshot. Команды `build`, `status`, `impact`, `check-scope` и Plugin
`sync` не входят в контракт.

## Архитектура Plugin

| Слой | Файлы | Ответственность |
| --- | --- | --- |
| Plugin facade | `index.js` | Store-only lifecycle и подключение публичных команд |
| CLI | `lib/commands.js` | `inspect`, `view`, human/JSON output и exit codes |
| Orchestration | `lib/service.js` | Запуск package compiler через PluginContext и строгая OpenSpec validation |
| Native launcher | `bin/openspec-graph.js` | Изолированный package-owned entrypoint компилятора |
| Input layer | `lib/compiler-input.js` | Обход Store, YAML/Markdown parsing и source locations |
| Projection | `lib/builder.js` | Создание нод, связей и содержательных diagnostics |
| Report model | `lib/report.js` | Детерминированная сортировка, provenance, statuses и summary |
| Read queries | `lib/query.js` | Точный neighborhood ноды и impact одного Change |
| Viewer | `lib/viewer.js`, `viewer/` | Read-only loopback server и визуализация готового report |

В Core нет OpenSpec Graph-specific ветвлений. Core выбирает Store-контекст и
предоставляет Plugin API, а грамматика OpenSpec, модель графа, compiler и viewer
остаются внутри package `@openspec-orch/plugin-openspec-graph`.

## Команды

```bash
openspec-orch graph inspect
openspec-orch graph inspect --json
openspec-orch graph view
openspec-orch graph view --port 0
```

### `graph inspect`

Компилирует Store и печатает каждую ноду и связь:

- `[✓]` — элемент корректен;
- `[!]` — есть warning;
- `[✗]` — есть error.

После элементов выводятся `nodes`, `edges`, `errors` и `warnings`. При наличии хотя
бы одной error команда возвращает ненулевой exit code. `--json` возвращает полный
Graph Report с тем же результатом проверки.

### `graph view`

Компилирует Store заново, печатает только summary и запускает read-only UI на
`127.0.0.1`. `--port 0` выбирает свободный порт.

Recoverable errors не блокируют viewer: ошибочные элементы выделяются красным,
warnings — жёлтым, а diagnostics без конкретной ноды или связи показываются в секции
«Ошибки графа». Viewer работает, пока выполняется команда, и не обновляется при
последующих изменениях файлов — для нового состояния команду нужно перезапустить.

## Входные данные

| Источник | Что извлекается | Если отсутствует |
| --- | --- | --- |
| `openspec-orch.yaml` | Store ID и зарегистрированные Code Repositories | Orchestrator не сможет предоставить нормальный Store-контекст |
| `openspec/specs/**/spec.md` | Текущие Master Specs | Допустимо для нового или пустого Store |
| `openspec/changes/<change-id>/` | Активные Changes | Допустимо |
| `openspec/changes/archive/<date>-<change-id>/` | Архивные Changes | Допустимо, но исторические Repository-связи восстановить будет не из чего |
| `<change>/specs/**/spec.md` | Delta Specs и capability path | Change получает warning, кроме `skip_specs: true` |
| `<change>/proposal.md` | Repository Impact | Change с Delta Specs получает warning; прямые Repository-связи не создаются |
| `<change>/.openspec.yaml` | Native `skip_specs` | Считается `false` |
| `openspec-graph.yaml` | Необязательные aliases полных Delta operation headings | Используются встроенные стандартные OpenSpec headings |

Пустой Store с зарегистрированными Repository является корректным графом.

### Альтернативные Delta operation headings

Plugin всегда распознаёт четыре встроенных OpenSpec heading независимо от наличия
конфигурации:

| Heading | Каноническая operation |
| --- | --- |
| `## ADDED Requirements` | `ADDED` |
| `## MODIFIED Requirements` | `MODIFIED` |
| `## REMOVED Requirements` | `REMOVED` |
| `## RENAMED Requirements` | `RENAMED` |

Если профиль OpenSpec использует другой язык, текст или уровень Markdown heading,
Store может добавить aliases в необязательный package-specific файл
`openspec-graph.yaml`:

```yaml
version: 1
operation_headings:
  ADDED:
    - "### Добавленные требования"
  MODIFIED:
    - "## Требования изменены"
  REMOVED:
    - "#### Удалённые требования"
  RENAMED:
    - "## Переименованные требования"
```

Значение alias — полный Markdown heading вместе с `#`. Aliases только дополняют, но
не заменяют встроенный набор. При сопоставлении не учитываются регистр, вид Unicode
символов и повторяющиеся пробелы. Результат всегда канонизируется в `ADDED`,
`MODIFIED`, `REMOVED` или `RENAMED`, поэтому формат Graph Report и viewer не зависит
от языка исходной Delta Spec.

Один маппинг применяется одинаково к активным и архивным Changes. Если один heading
сопоставлен разным operations, версия неизвестна или структура файла неверна,
компилятор добавляет recoverable error, атомарно отбрасывает все пользовательские
aliases и продолжает строить частичный граф на встроенном наборе.

Маппинг расширяет только разбор OpenSpec Graph. Внешняя команда
`openspec validate --all --strict` остаётся независимым источником validation: если
установленный OpenSpec CLI не принимает альтернативный синтаксис, report дополнительно
получит `OPENSPEC_VALIDATION_FAILED`.

Файл не создаётся Plugin автоматически, не является состоянием графа и не требует
обслуживания агентом. Для стандартного OpenSpec Store он не нужен.

## Ноды

Все node IDs детерминированы и не зависят от порядка обхода файлов.

| Тип | ID | Источник | Состояния и смысл |
| --- | --- | --- | --- |
| `store` | `store:<store-id>` | Project/Store context | Корневая нода одного Store |
| `repository` | `repository:<repository-id>` | `openspec-orch.yaml` | `registered`; неизвестная ссылка из Repository Impact остаётся placeholder-нодой `missing` с error |
| `master-spec` | `master-spec:<capability>` | `openspec/specs/<capability>/spec.md` или Delta Spec | `current` для реальной Master Spec; `planned` для capability только активного Change; `missing` для архивной Delta без текущей Master Spec |
| `change` | `change:<change-id>` | Активный или архивный каталог Change | `active` или `archived`; у стандартного archive-префикса `YYYY-MM-DD-` дата не входит в Change ID |
| `delta-spec` | `delta-spec:<change-id>/<capability>` | `<change>/specs/<capability>/spec.md` | Наследует `active` или `archived` от Change и хранит capability path |

`state` описывает жизненный цикл сущности. `status` описывает результат проверки и
равен `ok`, `warning` или `error`. Это разные поля: например, архивный Change может
иметь `state: archived` и `status: ok`.

Placeholder-ноды сохраняют ошибочную ссылку в частичном графе, чтобы `inspect` и
viewer могли показать место поломки вместо удаления всей связанной области.

## Связи

| Source | Relation | Target | Как выводится | Смысл |
| --- | --- | --- | --- | --- |
| Store | `contains` | Repository | Из registry `openspec-orch.yaml` | Repository зарегистрирована в Project |
| Store | `contains` | Master Spec | Из Master Spec или первой Delta Spec capability | Capability известна Store |
| Store | `contains` | Change | Из активного или архивного каталога | Change принадлежит Store |
| Change | `contains` | Delta Spec | Из пути Delta Spec | Delta Spec принадлежит Change |
| Change | `affects` | Master Spec | Из capability path Delta Spec | Change затрагивает capability; `operations` содержит найденные Delta operations |
| Delta Spec | `changes` | Master Spec | По одному edge на уникальный Delta heading | Конкретная Delta Spec выполняет `ADDED`, `MODIFIED`, `REMOVED` или `RENAMED` |
| Change | `changes_in` | Repository | Из колонки Repository таблицы Repository Impact | Change явно затрагивает Repository |
| Repository | `linked` | Master Spec | Из Repository и capability одной строки Repository Impact того же Change | Нейтральный факт участия Repository в Change этой capability |

Все связи имеют `derived: true` и непустой `provenance`. Источник представлен
структурированным объектом:

```json
{
  "path": "openspec/changes/add-checkout/proposal.md",
  "line": 18,
  "field": "repository-impact[0].capabilities[0]"
}
```

Одинаковая Repository–Master Spec пара отображается одной `linked`-линией. Если её
подтверждают несколько активных или архивных Changes, edge агрегирует:

- `via_changes` — отсортированные Change IDs;
- `provenance` — точные места каждого объявления.

При раскрытии конкретного Change viewer показывает только `linked`, у которых этот
Change присутствует в `via_changes`. Связи другого Change не попадают в его impact.

### Семантика `linked`

`linked` означает только: Repository была указана в Change, имевшем Delta Spec для
этой capability. Связь не утверждает:

- владение capability;
- наличие или завершённость реализации;
- вызов одного компонента другим;
- техническую зависимость;
- актуальность конкретной ревизии исходного кода.

## Repository Impact

Прямые Repository–Master Spec связи создаются только из строгой таблицы Proposal:

```markdown
## Repository Impact

| Repository | Capabilities |
| --- | --- |
| `frontend` | `orders/checkout` |
| `backend` | `orders/checkout`, `payments/processing` |
```

Правила:

- заголовок секции должен быть ровно `## Repository Impact`;
- таблица содержит ровно две колонки `Repository` и `Capabilities`;
- repository-id должен существовать в `openspec-orch.yaml`;
- capability должна иметь Delta Spec в том же Change;
- несколько capabilities перечисляются через запятую;
- дублированная секция или пара Repository–capability является error;
- свободный список Repository не создаёт `changes_in` или `linked`;
- сопоставления выполняются по строкам, поэтому не возникает неявного cross-product.

## Graph Report

```json
{
  "report_version": 1,
  "graph_version": 1,
  "state": "ready",
  "nodes": [],
  "edges": [],
  "diagnostics": [],
  "summary": {
    "nodes": 0,
    "edges": 0,
    "errors": 0,
    "warnings": 0
  }
}
```

`state` равен `invalid`, если существует хотя бы одна error. Warnings не делают
report invalid. Ноды и связи сортируются по ID, provenance — по `path`, `line` и
`field`, а `via_changes` — по Change ID. Одинаковые входные файлы создают
одинаковую проекцию компилятора. Итоговая strict-validation diagnostic также
зависит от внешнего OpenSpec CLI.

Diagnostic содержит:

- стабильный ID внутри report;
- `code`, `severity` и сообщение;
- `elements` — IDs затронутых нод и связей;
- опциональный `source` с `path`, `line` и `field`.

## Диагностика

### Warnings

| Code | Условие |
| --- | --- |
| `CHANGE_WITHOUT_DELTA_SPECS` | Change не содержит Delta Specs и не помечен `skip_specs: true` |
| `REPOSITORY_IMPACT_MISSING` | У Change есть Delta Specs, но нет строгой таблицы Repository Impact |
| `UNLINKED_MASTER_SPEC` | Ни активные, ни архивные Changes не связывают Master Spec с Repository |

### Recoverable errors

| Code | Условие |
| --- | --- |
| `ARCHIVED_MASTER_SPEC_MISSING` | Архивная Delta Spec не имеет соответствующей текущей Master Spec |
| `GRAPH_UNKNOWN_REPOSITORY` | Repository Impact ссылается на отсутствующий registry ID |
| `REPOSITORY_IMPACT_UNKNOWN_CAPABILITY` | Capability из таблицы не имеет Delta Spec в том же Change |
| `REPOSITORY_IMPACT_TABLE_INVALID` | Заголовок или структура таблицы неверны |
| `REPOSITORY_IMPACT_DUPLICATE_SECTION` | Proposal содержит несколько секций Repository Impact |
| `REPOSITORY_IMPACT_DUPLICATE_MAPPING` | Пара Repository–capability объявлена повторно |
| `REPOSITORY_IMPACT_ROW_INVALID` | Строка таблицы пуста или структурно некорректна |
| `REPOSITORY_IMPACT_EMPTY` | Валидная таблица не содержит ни одного mapping |
| `OPERATION_HEADINGS_CONFIG_INVALID` | Необязательный operation heading mapping имеет неверную структуру или конфликт aliases |
| `DELTA_OPERATIONS_MISSING` | Delta Spec не содержит встроенного или настроенного operation heading |
| `DELTA_OPERATION_DUPLICATE` | Одна operation-секция повторена в Delta Spec |
| `CHANGE_METADATA_INVALID` | `.openspec.yaml` Change не парсится как YAML |
| `OPENSPEC_VALIDATION_FAILED` | Внешняя строгая OpenSpec validation завершилась ошибкой |

Recoverable error сохраняет частичный Graph Report. `inspect` завершится с exit code
`1`, но `view` откроется и покажет доступные элементы и diagnostics.

### Fatal errors

Fatal error означает, что даже частичную модель нельзя безопасно сформировать. К ним
относятся, например:

- symlink вместо ожидаемого файла или каталога Store;
- не-directory на месте структурного каталога;
- дублированный Repository, Change, Delta Spec или внутренний edge ID;
- некорректный capability path;
- повреждённый или неполный output package compiler.

Fatal error останавливает `inspect` и `view`; viewer не запускается.

## Жизненные сценарии

### Новая capability

Активная Delta Spec создаёт `planned` Master Spec, даже если текущего
`openspec/specs/<capability>/spec.md` ещё нет. Repository Impact уже может связать её
с Repository как планируемое изменение.

### Archive после применения Delta

После применения Delta появляется `current` Master Spec. Архивный Change и его
Repository Impact продолжают подтверждать `linked`, поэтому отсутствие активных
Changes не удаляет связь Repository–Master Spec.

### Master Spec без активных Changes

Master Spec остаётся в графе. Если связь находится в Archive, она отображается
обычно. Если ни активный слой, ни Archive не содержат Repository Impact для этой
capability, нода получает `UNLINKED_MASTER_SPEC`.

### Неконсистентный Archive

Если архивная Delta Spec осталась, а текущей Master Spec нет, компилятор создаёт
`missing` placeholder и `ARCHIVED_MASTER_SPEC_MISSING`. Это отличает ещё не
реализованную capability активного Change от сломанного результата Archive.

## Ограничения

- Компиляция полная, не инкрементальная. Время команды растёт вместе с количеством
  Specs, Changes и Archive.
- Viewer показывает snapshot на момент запуска и не следит за файловой системой.
- Историческая Repository-связь существует только пока соответствующий архивный
  Change сохраняет Proposal с Repository Impact и Delta Specs. Удалённый или старый
  Archive без таблицы не позволяет восстановить эту связь.
- Парсер использует только стандартные пути и файлы с именем `spec.md`.
- Delta operations распознаются по встроенным headings или полным aliases из
  `openspec-graph.yaml`. Произвольные регулярные выражения не выполняются; содержимое
  Requirements и Scenarios не используется для построения дополнительных связей.
- Repository Impact является строгим структурным контрактом. Свободный Markdown,
  дополнительные колонки и неявные списки Repository не интерпретируются.
- Plugin не сканирует checkout Code Repository, Git history или commits и не
  подтверждает соответствие реализации спецификации.
- Plugin не выводит ownership, runtime calls, зависимости между capabilities или
  зависимости между Changes.
- Нет persisted cache или last-known-good fallback: сломанный текущий Store создаёт
  текущий invalid report, а не показывает предыдущий успешный граф.
- Viewer доступен только локально через loopback, является read-only и живёт только
  в процессе команды `graph view`.
