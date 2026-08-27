# Инструкции для агента

## Источники истины

- Текущий репозиторий — центральный OpenSpec Store. Requirements и Changes
  принадлежат каталогу openspec/; Code Repositories только реализуют принятые Changes.
- openspec/context/ содержит подтверждённый долговечный контекст, но не заменяет
  Requirements. Его обновляет только команда /openspec-base-context.
- openspec-orch.yaml — реестр точных repository-id. OpenSpec Graph автоматически
  компилирует структуру Store и Repository Impact активных и архивных Changes.
- Локальное устройство, test/build commands и implementation evidence принадлежат
  конкретному Code Repository и не копируются в Store context.

## КРИТИЧЕСКИЕ ЗАПРЕТЫ

ЭТИ ПРАВИЛА ОБЯЗАТЕЛЬНЫ. Полнота ответа, удобство и желание «добавить контекст» не
являются оправданием для нарушения.

1. НЕ ОТКРЫВАЙ Code Repository или CodeGraph при создании Intent, Intake, Proposal,
   Requirements и Scenarios. Их источники — запрос и решения владельца, Master Specs
   и подтверждённый Store context.
2. На Design, Tasks, Apply либо при точечной проверке current-state conflict из
   context command открывай Code Repository ТОЛЬКО для подтверждения или опровержения
   одного заранее сформулированного утверждения, проверки совместимости либо
   реализуемости принятого решения.
3. ЗАПРЕЩЕНО переносить в Store paths, symbols, модули, таблицы, библиотеки, локальную
   конфигурацию, build/test commands, code inventory и path:line. Код может подтвердить
   только constraint, conflict, implementation gap или unknown.
4. В Store разрешены только наблюдаемое поведение, доменные правила, repository-id,
   принятые системные решения и публичные контракты.
5. Если правило нарушено или его нельзя выполнить однозначно, НЕМЕДЛЕННО ОСТАНОВИСЬ.
   Не завершай артефакт и верни blocker с точной причиной.

## Маршрутизация

- Каждый новый Change начинается с согласованного Intent. Если пользователь уже
  передал принятый Daily Intent Brief, Jira Story или другой источник, в котором явно
  определены изменение, Why Now, ожидаемое улучшение, критерии успеха и ограничения,
  НЕ запускай base-intent повторно. Если такого Intent нет или он неполон, используй
  base-intent до создания Change. base-intent не создаёт файл и не является artifact.
- Опрос и сборка первого artifact Change со schema base-v1:
  /openspec-base-intake <change-id>. Передай ей согласованный Intent; команда сама
  переносит его и остальные ответы пользователя в intake.md, не задаёт повторно уже
  закрытые вопросы и при повторном запуске продолжает с подтверждённого контекста.
  После Intake пользователь выбирает /opsx-explore, переход к Proposal или
  дополнительное уточнение; агент не запускает следующий маршрут автоматически.
- Проверка Proposal, Specs, Design, Tasks, impact или полного Planning:
  openspec-base-meta-planning.
- Единый entrypoint preflight штатного Apply: openspec-base-apply-context. Без Change
  Tracking он готовит standard mode; при подключённом Plugin передаёт его часть
  установленному plugin-owned skill change-tracking-apply-context, затем продолжает
  общий Graph preflight.
- Трассируемые test cases: openspec-base-test-cases.
- Инициализация, общий или change/spec/domain-scoped аудит и обновление Store context
  и ADR: /openspec-base-context. После Archive context audit является необязательным
  promotion-механизмом и не изменяет Master Specs автоматически.

Правила текущего artifact получай через `openspec instructions <artifact> --change
<change-id> --json`: OpenSpec объединяет schema instructions и `openspec/config.yaml`.
Не восстанавливай их по краткому описанию skills или пользовательской документации.
Диалоговый flow Intake дополнительно задаёт `/openspec-base-intake`.

Repository Impact — не инвентаризация registry. ОБЯЗАН указывать ТОЛЬКО Repository,
где Change требует изменения кода, тестов, конфигурации или документации. ЗАПРЕЩЕНО
добавлять остальные зарегистрированные, соседние, verification или review-only
repositories и создавать для них строки no-change. Используй только таблицу
`Repository | Capabilities`: точный repository-id и точные capability paths из
Proposal/Delta Specs, разделённые запятыми. Свободный список не является источником
Repository–Master Spec связей.

Единственный project subagent — openspec-base-repository-evidence-scout. Он разрешён
только на Design, Tasks, Apply или при явной проверке current-state conflict из
context command.

- Один вопрос — один новый subagent: после декомпозиции N вопросов ОБЯЗАНЫ создать
  ровно N независимых вызовов. Например, пять вопросов — пять subagents.
  Не объединяй вопросы в одном prompt и не продолжай тот же subagent-контекст со
  следующим вопросом.
- До запуска основной агент обязан разложить общий запрос на независимые технические
  repository-specific вопросы. Межрепозиторный вопрос сначала раздели на отдельный
  вопрос для каждого Repository и только затем считай число требуемых вызовов.
- Каждый вызов получает question_id, один вопрос, один repository-id, проверенный
  checkout, полный Git SHA и непустые anchors. Identity, revision и чистоту worktree
  основной агент проверяет до вызова, а не передаёт как декларативные флаги.
- Новый или уточнённый вопрос всегда требует нового вызова. Независимые вызовы можно
  выполнять параллельно только после подготовки полного входного контракта для каждого.
- Каждый subagent ОБЯЗАН вернуть только один YAML-объект `repository_evidence` с
  полями question_id, status, answer и evidence, без текста до или после YAML.
  Paths, symbols и code inventory допустимы только в evidence; в Change основной
  агент переносит только синтезированный constraint, conflict, implementation gap
  или unknown.

Основной агент сам читает Store-level context, выполняет Planning review и проверяет
результаты scout. Отдельные context/planning subagents не используются.

## OpenSpec Graph lifecycle

Текущий Project Template объявляет OpenSpec Graph Plugin обязательным. Он ДОЛЖЕН
присутствовать в openspec-orch.yaml с `required: true` и быть подключён к Store.
Если declaration отсутствует, остановись и предложи повторить `openspec-orch init`;
не обходи Graph workflow как опциональный.

OpenSpec Graph не имеет build, freshness status, persisted index или maintenance
skill. Он компилирует текущий Store при каждом вызове:

- `openspec-orch graph inspect` печатает каждую ноду, связь и diagnostics;
- `openspec-orch graph inspect --json` возвращает тот же полный report;
- `openspec-orch graph view [--port 0]` компилирует тот же report и запускает viewer.

После создания или изменения Delta Specs, Repository Impact, Master Specs, registry
или Archive выполни `graph inspect --json`. Любая error блокирует переход; warning
требует явного разбора, но не означает stale state и не требует recovery. Intake и
Proposal до валидных Delta Specs можно проверять без Graph, используя точные данные
Store.

Связь `Repository — linked — Master Spec` нейтральна: Repository был указан в Change,
затрагивающем capability. Она не доказывает владение, runtime-вызов или техническую
зависимость. Источниками являются структурированный Repository Impact и Delta Specs
одного активного или архивного Change. Если Master Spec не имеет такой связи, Graph
оставляет её видимой и возвращает `UNLINKED_MASTER_SPEC` warning.

## Доступ к Code Repository

- Открывай Code Repository только для одного конкретного технического утверждения,
  которое нельзя проверить по Store, Specs, Graph и подтверждённой архитектуре.
- Путь принимай только из разрешённого runtime/workset root, явного абсолютного пути
  пользователя или openspec-orch repository status --repo <repository-id>. Не читай
  .openspec-orch/state.json напрямую.
- Канонизируй path, проверь Git root, repository identity, полный HEAD и допустимое
  состояние worktree. Не ищи workspace или checkout обходом файловой системы.
- Ограничивай чтение одним checkout. Не открывай родительские, соседние repositories
  и другой repository Cycle в том же evidence request.
- CodeGraph используй только внутри уже разрешённого Repository и только когда его
  index соответствует revision. Он ускоряет навигацию, но не доказывает runtime
  behavior или выполнение проверки.

Если path или revision не подтверждены, останови repository-specific исследование и
запроси точный путь либо предложи пользователю выполнить openspec-orch connect.

## Постоянные ограничения

- Не создавай openspec/changes/ в Code Repositories.
- Не изменяй встроенные openspec-* skills и opsx-* commands.
- openspec-base-meta-planning — единственный project meta-skill. Остальные skills и
  repository scout являются leaf-артефактами и не вызывают skills, commands или
  других agents.
- /openspec-base-context может вызвать только repository evidence scout и только по
  его полному входному контракту.
- Результат skill или subagent не является человеческим Gate.
- Не выполняй commit, push, merge, release или Archive без явного пользовательского
  действия или принятого командного процесса.
- Не архивируй Change до завершения реализации затронутых repositories и ручной
  проверки. До и после Archive выполни guidance из openspec/config.yaml.
