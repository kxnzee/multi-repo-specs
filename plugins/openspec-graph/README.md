# OpenSpec Graph Plugin

`@openspec-orch/plugin-openspec-graph` строит единый Store-level граф для
мультирепозитория. Он заменяет ручную карту систем, но не заменяет CodeGraph и не
анализирует внутреннее устройство кода.

## Модель

Plugin создаёт пять типов узлов:

- `store:<id>` — корень текущего OpenSpec Store;
- `repository:<id>` — Code Repository из `openspec-orch.yaml`;
- `master-spec:<capability-path>` — текущая capability из `openspec/specs/`;
- `change:<change-id>` — активный или архивный OpenSpec Change;
- `delta-spec:<change-id>/<capability-path>` — активная или архивная Delta Spec.

Типизированная Store-level модель строится детерминированно. Store и Repository
берутся из контекста Orchestrator, а Change,
Delta Spec и затрагиваемая Master Spec — из структуры OpenSpec. Операции `ADDED`,
`MODIFIED`, `REMOVED` и `RENAMED` читаются из стандартных секций Delta Spec и
агрегируются на связи Change с Master Spec. Исходная связь Delta Spec → Master Spec
с каждой отдельной операцией сохраняется для машинных запросов. В
`openspec/graph.yaml` хранятся только явные связи, которые нельзя безопасно вывести
из OpenSpec:

```yaml
version: 1
edges:
  - source: master-spec:conference/visitors
    relation: implemented_by
    target: repository:web
    sources:
      - docs/architecture.md:18

  - source: repository:web
    relation: calls
    target: repository:control
    contract: Conference Control API
    sources:
      - docs/architecture.md:31
```

Структурные отношения модели:

```text
Store contains Repository
Change contains Delta Spec
Change affects Master Spec
Delta Spec changes Master Spec
Master Spec implemented_by Repository
Master Spec depends_on Master Spec
Delta Spec targets Repository
```

Каждый `sources` — существующий Store-relative `path:line`. Dangling nodes,
дубликаты, неподдерживаемые направления, отсутствующее evidence и `calls` без
контракта блокируют сборку. Предположения по именам и транзитивные связи не
достраиваются.

Если source указывает на файл активного `openspec/changes/<change-id>/`, после
штатного Archive builder разрешает тот же файл через единственный архивный каталог
`openspec/changes/archive/<date>-<change-id>/` и возвращает его канонический архивный
path в provenance. Для других отсутствующих paths сборка по-прежнему завершается
ошибкой.

## Граница с CodeGraph

OpenSpec Graph отвечает на вопросы «какой Change меняет какую capability и какие
репозитории затронуты». CodeGraph отвечает на вопросы «какие файлы, символы и вызовы
затронуты внутри выбранного Code Repository». Plugins не читают индексы друг друга и
могут использоваться независимо.

## Plugin Template

Plugin владеет skill `openspec-graph-maintenance` и начальным
`openspec/graph.yaml`. Они находятся в `template/`, который Core автоматически
применяет через общий `ProjectTemplateService` при `plugin init`; `index.js` не
содержит Agent integration или copy rules. Поддерживаются Claude, Codex, GigaCode
и Qwen.

Отличающийся существующий файл блокирует установку, одинаковый пропускается.
`plugin remove` не удаляет добавленные в Store файлы: CLI перечисляет пути skill и
`openspec/graph.yaml` для ручной очистки. Base Template эти файлы не поставляет и
не обновляет.

## Использование

Из корня Store:

```bash
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph build
openspec-orch graph status
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
openspec-orch graph inspect <node-id>
openspec-orch graph view
```

Текущий Base Project Template объявляет `openspec-graph` обязательным, поэтому
`openspec-orch init` уже устанавливает Package и сохраняет `required: true`.
Для Custom Template без этой зависимости Plugin можно установить отдельно через
`openspec-orch plugin init --plugin openspec-graph`.

`plugin connect` только создаёт Store binding и не валидирует незавершённые Changes,
поэтому его можно безопасно выполнить, когда Change находится на Intake или Proposal.
Индекс при подключении не создаётся: первый `graph build` запускается явно и сохраняет
прежний fail-closed контракт строгой валидации. Для Store без активных Changes его
можно выполнить сразу; при Intake-only или Proposal-only Change нужно сначала создать
валидные Delta Specs. До build `graph status` возвращает `unavailable` и предлагает
точную следующую команду.

`inspect` принимает только точный node ID и не выбирает fuzzy candidate. Если
capability path неизвестен, сначала выполните `openspec list --specs --json` и
выберите точный capability ID. При Intake/Proposal без валидных Delta Specs прочитайте
точную Master Spec напрямую: Graph ещё не authoritative и не должен принуждать к
преждевременному build. После появления валидных Delta Specs выполните build и только
затем используйте `graph inspect master-spec:<capability-path>`.

`impact` и `inspect` дают любому агенту provider-independent JSON из того же свежего
индекса, который показывает UI. `impact` разделяет `direct_master_specs` — Master
Specs с Delta Spec внутри выбранного Change, `dependent_master_specs` — downstream
Master Specs, которые прямо или транзитивно зависят от изменяемых, и
`total_master_specs` — их объединение без дубликатов. Репозитории аналогично
разделены на `direct_repositories`, `dependent_repositories` и общий `repositories`.
Репозитории, которые проверяют затронутые Master Specs через `verifies`, и
направленно затронутые repositories по явным `depends_on` или `calls` отдельно
возвращаются как `verification_repositories`,
`related_repositories` и их объединение `review_repositories`. Они требуют проверки
влияния, но не добавляются автоматически в implementation scope. `all_repositories`
объединяет implementation scope и review-контур для отображения и машинной обработки.
Repository-связи учитываются только на один переход и не распространяются
транзитивно через весь мультирепозиторий.

Направление Repository relations фиксировано:

- `source depends_on target`: изменение dependency `target` отправляет dependent
  `source` на review;
- `source calls target`: изменение предоставляемого `target` contract отправляет
  caller `source` на review;
- `source publishes_to target`: фиксирует publisher и прямого consumer именованного
  event contract, но сама по себе не добавляет Repository в impact или review.

Обратное влияние для направленных impact-отношений не выводится автоматически.
Транзитивное влияние строится только по явно подтверждённым связям Master Spec
`depends_on`; отсутствующие связи не угадываются.

Change dependencies возвращаются в обоих направлениях:
`prerequisite_changes.direct/transitive` показывают Changes, от которых зависит
выбранный Change, а `dependent_changes.direct/transitive` — активных или архивных
потребителей выбранного Change. Совпавшие Delta Specs одного Change не создают
внешнюю self-dependency. Поле `dependency_changes` временно сохраняется как
совместимый объединённый список prerequisites.

`check-scope` сравнивает предложенный набор Code Repositories для Cycle с этим
impact. Прямые репозитории обязательны; их отсутствие, Change без Delta Specs или
непривязанная напрямую изменяемая Master Spec завершают команду ошибкой. Зависимые и
review-репозитории выводятся для явного решения, но не включаются в Cycle
автоматически. Переданный review-only или не относящийся к impact дополнительный
репозиторий также делает scope `invalid`: если в нём действительно требуется
изменение, сначала обновите Repository Impact, Design, Tasks и Graph mapping.

`build` сначала выполняет строгую валидацию OpenSpec, затем атомарно заменяет
последний успешно собранный индекс в Plugin storage. `view` поднимает read-only UI
на loopback-интерфейсе и использует vendored vis-network без внешнего CDN.

`source_digest` следует topology-only контракту: включает Store ID, `repository-id +
role`, Master Specs, Delta Specs, состояние каталогов Changes, `openspec/graph.yaml` и
файлы evidence explicit edges. Proposal, Design и Tasks не входят сами по себе; Design
попадает в digest только когда его строка является explicit-edge evidence. Поэтому
переключение checkbox Tasks не делает граф stale.

`graph status` по умолчанию показывает человекочитаемую сводку с `✓`, `⚠` или `✗`,
числом узлов и рёбер, digest и следующим действием. `graph status --json` возвращает
`ready`, `stale`, `unavailable` или `invalid`, признак
`authoritative`, наличие last known-good и `next_command`. Last known-good доступен
только для диагностики: `inspect`, `impact`, `check-scope` и `view` читают граф лишь
при свежем `ready` состоянии.
Интерфейс использует один force-directed граф без колонок. Store задаёт границу и
имя открытого графа, но не занимает отдельный узел. Репозитории, Master Specs и
Changes постоянно находятся на canvas и образуют кластеры по реальным связям.
Глобальная физика выполняет один ограниченный проход, после чего отключается, чтобы
граф не дёргался. При перетаскивании Repository его Master Specs, а при
перетаскивании Change раскрытые Delta Specs двигаются вместе с родителем, сохраняя
взаимные расстояния. Прочие прямые соседи получают только небольшое пружинное
смещение. Обновления объединяются в один кадр без повторного запуска общей
симуляции. Рёбра всегда остаются прямыми, поэтому дальнее перемещение кластера не
создаёт длинных петель. На далёком масштабе подписи Master Specs скрыты и
появляются при приближении или фокусе.

Delta Specs всегда отображаются компактными кластерами вокруг своих Changes — так
же, как Master Specs группируются вокруг Repository. Связи от Delta Specs к Master
Specs показывают точные операции `ADDED`, `MODIFIED`, `REMOVED` и `RENAMED`. При
включённом слое Delta Spec связи `Delta Spec → targets → Repository` сохраняют
видимый путь до scope Change. Они не заменяют постоянные
`Master Spec → implemented_by → Repository`.

Четыре чекбокса позволяют независимо скрыть Repository, Master Spec, Change или
Delta Spec. По умолчанию видны Repository, Master Spec и Change, а подробный слой
Delta Spec выключен. В этом режиме агрегированная связь `Change → affects → Master
Spec` сохраняет видимый impact-путь. При включении соответствующей Delta Spec viewer
динамически скрывает дублирующую `affects` и показывает подробную цепочку
`Change → Delta Spec → Master Spec` вместе с `targets` до Repository. Вместе со
скрытыми узлами исчезают их рёбра; расположение остальных групп не перестраивается.

Выбор Change фокусирует его impact. Фиолетовая рамка обозначает напрямую изменяемые
Master Specs, бирюзовая — зависимые Master Specs с потенциальным downstream-влиянием.
Остальной граф приглушается, а инспектор показывает отдельные списки и общий размер
impact. Репозитории из `review_repositories` выводятся отдельным янтарным списком и
не смешиваются с прямым или зависимым implementation scope.

Путь к файлу в инспекторе открывает его read-only содержимое в новой вкладке. Меню
рядом позволяет повторить просмотр, открыть файл в VS Code (когда `graph view`
запущен из Store) или скопировать относительный путь. Источники связей используют
те же действия, а VS Code открывает источник на указанной строке. Viewer принимает
только файлы, указанные в узлах или валидированных provenance-ссылках графа, и читает
их через Store-scoped Files facade.

Поиск изолирует найденные узлы и их ближайшее окружение без перестроения физики.
Кнопка `Сбросить` возвращает полный обзор. Выбор Master Spec показывает её прямые
связи, а инспектор отдельно перечисляет `Зависит от` и `От неё зависят`.
