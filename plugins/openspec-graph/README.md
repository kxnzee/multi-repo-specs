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

Иерархия `Store → Repository → Master Spec → Change → Delta Spec` строится
детерминированно. Store и Repository берутся из контекста Orchestrator, а Change,
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

Каждый `sources` — существующий Store-relative `path:line`. Dangling nodes,
дубликаты, неподдерживаемые направления, отсутствующее evidence и `calls` без
контракта блокируют сборку. Предположения по именам и транзитивные связи не
достраиваются.

## Граница с CodeGraph

OpenSpec Graph отвечает на вопросы «какой Change меняет какую capability и какие
репозитории затронуты». CodeGraph отвечает на вопросы «какие файлы, символы и вызовы
затронуты внутри выбранного Code Repository». Plugins не читают индексы друг друга и
могут использоваться независимо.

## Использование

Из корня Store:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo <store-id>
openspec-orch graph build
openspec-orch graph status
openspec-orch graph impact <change-id>
openspec-orch graph inspect <node-id>
openspec-orch graph view
```

`impact` и `inspect` дают любому агенту provider-independent JSON из того же свежего
индекса, который показывает UI. `impact` разделяет `direct_master_specs` — Master
Specs с Delta Spec внутри выбранного Change, `dependent_master_specs` — downstream
Master Specs, которые прямо или транзитивно зависят от изменяемых, и
`total_master_specs` — их объединение без дубликатов. Репозитории аналогично
разделены на `direct_repositories`, `dependent_repositories` и общий `repositories`.
Транзитивное влияние строится только по явно подтверждённым связям Master Spec
`depends_on`; отсутствующие связи не угадываются.

`build` сначала выполняет строгую валидацию OpenSpec, затем атомарно заменяет
последний успешно собранный индекс в Plugin storage. `view` поднимает read-only UI
на loopback-интерфейсе и использует vendored vis-network без внешнего CDN.
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
Specs показывают точные операции `ADDED`, `MODIFIED`, `REMOVED` и `RENAMED`. Четыре
чекбокса позволяют независимо скрыть Repository, Master Spec, Change или Delta Spec;
по умолчанию включены все группы. Вместе со скрытыми узлами исчезают их рёбра;
расположение остальных групп не перестраивается.

Выбор Change фокусирует его impact. Фиолетовая рамка обозначает напрямую изменяемые
Master Specs, бирюзовая — зависимые Master Specs с потенциальным downstream-влиянием.
Остальной граф приглушается, а инспектор показывает отдельные списки и общий размер
impact.

Путь к файлу в инспекторе открывает его read-only содержимое в новой вкладке. Меню
рядом позволяет повторить просмотр, открыть файл в VS Code (когда `graph view`
запущен из Store) или скопировать относительный путь. Источники связей используют
те же действия, а VS Code открывает источник на указанной строке. Viewer принимает
только файлы, указанные в узлах или валидированных provenance-ссылках графа, и читает
их через Store-scoped Files facade.

Поиск изолирует найденные узлы и их ближайшее окружение без перестроения физики.
Кнопка `Сбросить` возвращает полный обзор. Выбор Master Spec показывает её прямые
связи, а инспектор отдельно перечисляет `Зависит от` и `От неё зависят`.
