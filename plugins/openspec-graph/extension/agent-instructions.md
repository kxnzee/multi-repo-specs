## OpenSpec Graph lifecycle

OpenSpec Graph подключён к текущему Store. Он компилирует состояние Store при каждом
вызове и не требует ручного graph state:

- `openspec-orch graph inspect` печатает каждую ноду, связь и diagnostics;
- `openspec-orch graph inspect --json` возвращает тот же полный report;
- `openspec-orch graph view [--port 0]` компилирует тот же report и запускает viewer.

После создания или изменения Delta Specs, Repository Impact, Master Specs, registry
или Archive выполни `openspec-orch graph inspect --json`. Любая error блокирует
переход, каждый warning требует явного разбора. Intake и Proposal до валидных Delta
Specs можно проверять без Graph, используя точные данные Store.

После успешного `graph inspect --json` используй текущий Graph Report как
навигационную карту Store:

- от Change переходи по `affects` к Master Specs и по `changes_in` к явно указанным
  Repositories;
- от Master Spec находи активные и архивные Changes и нейтральные `linked` связи с
  Repositories;
- учитывай состояния `current`, `planned`, `missing` и связанные diagnostics;
- для проверки основания связи возвращайся к `{ path, line, field }` provenance;
- используй карту, чтобы сузить чтение Store и сформулировать точечный вопрос к
  конкретному Code Repository до разрешённого обращения к CodeGraph.

Graph Report только проецирует уже объявленные структурные связи. Он не создаёт новый
scope и не доказывает ownership, runtime call, реализацию или техническую dependency.
Если структурной связи нет, сохраняй `unknown`: не восстанавливай её по догадке,
свободному Markdown или содержимому кода.

Связь `Repository — linked — Master Spec` нейтральна: Repository был указан в Change,
затрагивающем capability. Она не доказывает владение, runtime-вызов или техническую
зависимость. Источниками являются структурированный Repository Impact и Delta Specs
одного активного или архивного Change. Если Master Spec не имеет такой связи, Graph
оставляет её видимой и возвращает `UNLINKED_MASTER_SPEC` warning.
