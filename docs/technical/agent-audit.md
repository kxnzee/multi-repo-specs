# Аудит агентской поставки

Дата: 2026-09-07. Исходная revision: `d6ae68fca37eb2f808fe42fca2a0af5df01d8aa2`. Ранее согласованные исправления
команд и Store Template уже находятся в этой revision; настоящий аудит — отдельный diff.

## Охват и метод

Прочитаны все 139 файлов исходного инвентаря ниже: инструкции checkout, три Agent
adapter, standalone и Plugin-owned Extensions, manifests, hooks, 18 skills,
команды, subagents, reviewer prompts, вспомогательные скрипты, справочные примеры,
Template context, обе schemas и templates. Для каждого проверены назначение,
согласованность с вызывающим workflow, пути и применимые форматы. JSON/YAML и
локальные Markdown-ссылки вне демонстрационных code blocks проверены автоматически.

Сверка с runtime: `agents/native-extension.js`, provider adapters,
`bin/internal/orchestrator-mcp-runtime.js` (в частности assignment scope),
`plugins/openspec-graph/lib/agent.js`, структурные и lifecycle tests. CodeGraph был
использован для поиска кода; когда выдача не покрывала конкретный asset, прочитан
сам файл. Файлы Extensions исследовались как поставляемые данные, а не инструкции
для этого checkout. Встроенные OpenSpec assets и пользовательские профили не менялись.

## Исправленные группы проблем

| № | Проблема до аудита | Исправление и проверка |
| --- | --- | --- |
| A01 | Прямой вызов Apply, meta-planning или test-cases мог применить правила другой schema | Проверка schema до artifact-specific preflight; существующий Apply возвращает управление вызывающему workflow без рекурсии |
| A02 | Scout example передавал пустые anchors, meta-planning искал их в MCP scope, который их не возвращает | Непустой пример; anchors берутся из точного пользовательского ввода или подтверждённого evidence; иначе unknown; structural contract check |
| A03 | Apply допускал fallback при недоступном CodeGraph вопреки Extension policy; не различал отрицательное назначение и Store coordination | Явные условия assigned/role/revision и единый fallback contract |
| A04 | Superpowers bootstrap различался между провайдерами; Claude hook пропускал resume | Claude получает canonical distribution routing и полный bootstrap; resume включён; hook запускается в regression test |
| A05 | Plan/Apply передавали управление исполнению или finishing branch вопреки OpenSpec lifecycle | Условные handoffs: OpenSpec получает управление обратно; standalone flow сохраняется; inline executor учитывает выбор пользователя |
| A06 | Implementer получал только task text без global constraints и полномочий; незавершённая работа могла получить DONE_WITH_CONCERNS | Обязательные поля constraints, repository, checkout, base SHA, TDD и commit scope; корректное различение BLOCKED/DONE |
| A07 | Параллельные задачи не учитывали общий Git index/HEAD | В общем checkout Git mutations выполняет координатор; отдельные Git writes требуют отдельных worktrees |
| A08 | Review через HEAD~1 терял первые commits задачи; output мог обнуляться при неверном объекте Git | Записанный task base, разрешение обоих commit SHA до записи, временный output; regression на multi-commit range и blob вместо commit |
| A09 | Worktree проверял игнорирование любого каталога, переиспользовал чужую ветку, угадывал package manager и обходил обязательную isolation при sandbox error | Проверяется выбранный путь и identity; setup из repository instructions; сохранение обязательной isolation; нет побочного commit .gitignore |
| A10 | Closeout угадывал main/master и расположение checkout; Push/PR заканчивался push; detached menu не имел собственного исполнения | Target из принятого Git Flow; checkout из worktree list; PR URL или явный pending; отдельные detached actions |
| A11 | Debug example печатал значение переменной окружения; temp guard принимал совпадение строкового prefix | Только SET/UNSET; canonical paths и проверка границы каталога в reference example |
| A12 | Polluter возвращал успех при нуле тестов, готовом pollution path и упавших командах; терял имена с пробелами | NUL-separated filenames, явный exit 2 для inconclusive, сохранённый output тестов; все случаи воспроизведены |
| A13 | Visual launcher зависал без значения option и ломал относительный project-dir после cd | Проверка argv до mutation, canonical project-dir, fail-fast shell; regression на четыре пропущенных значения и реальный start/stop с относительным путём и пробелами |
| A14 | Stop-server удалял persistent mockups, если проект лежал в /tmp | Cleanup только собственного ephemeral имени; реальный временный процесс: baseline удаляет mockup, исправление сохраняет |
| A15 | Explicit choice API писал value, server ожидал choice; falsey choices терялись; версия companion была unknown | Согласованный event contract и manifests поставки; тест client → event file и version |
| A16 | Graph renderer падал из-за CommonJS в ESM checkout, требовал which на Windows и возвращал успех при ошибке dot | Module-neutral launcher, direct argv dot -V/-Tsvg, nonzero failure; tests обоих module types и renderer error |
| A17 | Примеры skill metadata нарушали собственный формат; ссылки debugging указывали старую структуру | Lowercase directory slug, отдельные лимиты name/description, актуальное имя skill; исторический reference явно помечен snapshot |
| A18 | Общие context/Gate 1 требовали Intake для Superspec и запрещали его Plan | Schema-specific Gate 1 и доступ к коду; technical execution data отделены от durable context |
| A19 | Обязательный Design назывался optional; templates теряли Repository map, task ownership, Scenario IDs и Purpose новой capability | Текст приведён к существующему DAG; template examples содержат обязательные части, межрепозиторная проверка имеет repository owner |
| A20 | Reference polling helper не превращал исключение позднего callback в rejection | try/catch внутри каждого polling callback; пример явно требует адаптации domain imports |

## Проверки и пределы вывода

- Новые regression tests: `test/agent-audit-helpers.test.js`; существующие
  `test/agent-workflow-helpers.test.js` и `test/structural/agent-artifacts.test.js`.
- Первые шесть новых тестов запущены на отдельной копии исходной revision:
  **0/6 passed**. На исправленных assets проходят; отдельно проверяется ошибка dot.
- Все 27 JSON, 10 YAML и 22 frontmatter blocks исходного инвентаря разбираются.
  Разорванных локальных Markdown links вне code examples не обнаружено.
- `npm run check`: environment и lint успешны, **354/354 tests passed**.
- `npm run test:pack`: **8 packages**, **5/5 consumer smoke tests passed**.
- `git diff --check`: ошибок нет.
- Shell helper tests требуют Bash; на Windows используется Git Bash из Git for
  Windows. В этой сессии исполнение проверено на macOS; Windows CI здесь не запускался.
- Реальные Claude/Qwen/GigaCode sessions и модельное выполнение skills не запускались.
  Это полный source/contract audit указанного инвентаря и runtime проверки helpers,
  а не подтверждение соблюдения инструкций всеми моделями или native clients.
- Graphviz отсутствует: проверены запуск renderer и обработка ошибки через fixture,
  визуальная корректность SVG не заявляется. Companion проверен на уровне scripts,
  hook, client/server event contract и cleanup; browser UI smoke не выполнялся.
- Vendored pressure scenarios, эмпирические проценты и исследовательские ссылки —
  исторический материал upstream, а не новые результаты этой поставки. Пакетная
  проверка не доказывает заявленную эффективность методик.

Текущий формат metadata сверялся с [Agent Skills specification](https://agentskills.io/specification),
а событие resume — с [Claude hooks reference](https://code.claude.com/docs/en/hooks#sessionstart).
Остальные provider grammar не менялись на основании предположений.

## Полный инвентарь

`изменён` означает исправление в этом аудитном diff; `проверен` — файл прочитан,
существенная проблема в рамках source/contract audit не подтверждена. Для LICENSE и
исторических references проверялись роль и согласованность поставки, а не юридическая
оценка или повторение исследований. SHA-256 относится к файлу после исправлений;
это позволяет отличить проверенный asset от последующего изменения.

| Файл | Результат | SHA-256 |
| --- | --- | --- |
| [AGENTS.md](../../AGENTS.md) | проверен | `8e6d84e68fba92b8c846a57dee7d2e361fabd42a498dbcf955cc91c2af247a17` |
| [agents/claude/adapter.js](../../agents/claude/adapter.js) | проверен | `9f7e515524c3955ba62ae436e6dea713b08e3b597a1eec37d8046d0c9e8650dd` |
| [agents/claude/agent.yaml](../../agents/claude/agent.yaml) | проверен | `6335b1c0232e43176201212700721ab02514027ed529105d6ac212651140e1e8` |
| [agents/gigacode/adapter.js](../../agents/gigacode/adapter.js) | проверен | `08418af7b57422e85a0935a20fc078d0ab84f9ff5d3f7ee5a3b05bb2d5d4a8dc` |
| [agents/gigacode/agent.yaml](../../agents/gigacode/agent.yaml) | проверен | `dd420f230eeb680fbebfca7c06717b8d262ce77028fe3a72be9f4d53aeaf11df` |
| [agents/native-extension.js](../../agents/native-extension.js) | проверен | `c429f6206d8833feba8a72e16b901d9dab12680b3bba44c4a457e05d34869db9` |
| [agents/qwen/adapter.js](../../agents/qwen/adapter.js) | проверен | `cbdef225dadd7f89fe24bbefcfc68f441a68dcb751e2ee53dc366fdba78af4de` |
| [agents/qwen/agent.yaml](../../agents/qwen/agent.yaml) | проверен | `846ad3a1370332a856e84790394fb3f351d2f305b017a457bec77e3afffcc513` |
| [extensions/orchestrator-agent/.claude-plugin/marketplace.json](../../extensions/orchestrator-agent/.claude-plugin/marketplace.json) | проверен | `c45205b1516d9a4d5462dece62ef8b8a687720e1a4679f7c92ebc3b68dd18f7a` |
| [extensions/orchestrator-agent/.claude-plugin/plugin.json](../../extensions/orchestrator-agent/.claude-plugin/plugin.json) | проверен | `81df1b5da0575e03b9610c925de3c70ffa1c11b3a00b142dfe668934912e50de` |
| [extensions/orchestrator-agent/.mcp.json](../../extensions/orchestrator-agent/.mcp.json) | проверен | `7ca89626cc6c98dec718810cb9dc62e659d9a9a333162a4bc7ef106749fbfa44` |
| [extensions/orchestrator-agent/agent-instructions.md](../../extensions/orchestrator-agent/agent-instructions.md) | проверен | `5d457df5d7ab1e2827ca05deccd7c5bbfca29ec8b2cb31f83d7787c4ebb4cdf3` |
| [extensions/orchestrator-agent/extension.yaml](../../extensions/orchestrator-agent/extension.yaml) | проверен | `8fdc901c291da8b6203a6d353683046f05b22ed01dfcd795057b1e9af053bab5` |
| [extensions/orchestrator-agent/gigacode-extension.json](../../extensions/orchestrator-agent/gigacode-extension.json) | проверен | `53f7ffd01dc501fd29492b1d6ea33779a1a1164e901336e73266e992eb07386b` |
| [extensions/orchestrator-agent/hooks/hooks.json](../../extensions/orchestrator-agent/hooks/hooks.json) | проверен | `6a1e80ce35ce4f96b4e0011a7a21ac8739ddea78e07e2b2b106dad888f497ff7` |
| [extensions/orchestrator-agent/hooks/session-start.js](../../extensions/orchestrator-agent/hooks/session-start.js) | проверен | `073dc5d35b28628f547360fac984117f4bc9630c6368bdd259574ea6accef254` |
| [extensions/orchestrator-agent/qwen-extension.json](../../extensions/orchestrator-agent/qwen-extension.json) | проверен | `53f7ffd01dc501fd29492b1d6ea33779a1a1164e901336e73266e992eb07386b` |
| [extensions/spec-driven-extended/.claude-plugin/marketplace.json](../../extensions/spec-driven-extended/.claude-plugin/marketplace.json) | проверен | `2080bddbd99dc2b2a10152b327b393a1a156db2add8ba4331bfc7c85fbae6178` |
| [extensions/spec-driven-extended/.claude-plugin/plugin.json](../../extensions/spec-driven-extended/.claude-plugin/plugin.json) | проверен | `5601d0e44c7bb25c7c04bdea9b36494463fbfb753f257d4b9fbdc62d28be2201` |
| [extensions/spec-driven-extended/adapters/claude/subagents/spec-driven-extended-repository-evidence-scout.md](../../extensions/spec-driven-extended/adapters/claude/subagents/spec-driven-extended-repository-evidence-scout.md) | изменён | `f1ede354409129589d56733adc02224a503cdbeae00e53ca1194dce3f39c824e` |
| [extensions/spec-driven-extended/agent-instructions.md](../../extensions/spec-driven-extended/agent-instructions.md) | проверен | `bbcd774c670297074f8d1ac6a0d8d038934f8156d0b38f906fa526ef40c91b2a` |
| [extensions/spec-driven-extended/commands/spec-driven-extended-context.md](../../extensions/spec-driven-extended/commands/spec-driven-extended-context.md) | проверен | `de6a7806d7f7efbda3787cf9c96c96d95b4550270b6a6b623c6beab4e79704cb` |
| [extensions/spec-driven-extended/commands/spec-driven-extended-intake.md](../../extensions/spec-driven-extended/commands/spec-driven-extended-intake.md) | проверен | `352ecb092e0b411565ee0f73186d5dee3bbd0d83b46b4c46bd4e4ad03569077c` |
| [extensions/spec-driven-extended/extension.yaml](../../extensions/spec-driven-extended/extension.yaml) | проверен | `6429c9b80c3ea43d583003f032051b8b46f45d95c3fe6d19618968c230921017` |
| [extensions/spec-driven-extended/gigacode-extension.json](../../extensions/spec-driven-extended/gigacode-extension.json) | проверен | `052aff0a32ae7df119288428c45256036d2e8476ac874eeaf03cf9b726b54b0d` |
| [extensions/spec-driven-extended/hooks/hooks.json](../../extensions/spec-driven-extended/hooks/hooks.json) | проверен | `6a1e80ce35ce4f96b4e0011a7a21ac8739ddea78e07e2b2b106dad888f497ff7` |
| [extensions/spec-driven-extended/hooks/session-start.js](../../extensions/spec-driven-extended/hooks/session-start.js) | проверен | `023231aba00668ee69b0410a30da13c58fc02f1a14a5d862bb346583b2986b8f` |
| [extensions/spec-driven-extended/qwen-extension.json](../../extensions/spec-driven-extended/qwen-extension.json) | проверен | `052aff0a32ae7df119288428c45256036d2e8476ac874eeaf03cf9b726b54b0d` |
| [extensions/spec-driven-extended/skills/spec-driven-extended-apply-context/SKILL.md](../../extensions/spec-driven-extended/skills/spec-driven-extended-apply-context/SKILL.md) | изменён | `272041f2d411a509dea237ca5ee1986f69b9d049f9ebfaa623b98f6d43612fff` |
| [extensions/spec-driven-extended/skills/spec-driven-extended-intent/SKILL.md](../../extensions/spec-driven-extended/skills/spec-driven-extended-intent/SKILL.md) | проверен | `90bc2a3014bbcbd701dafa7ff1fd4383f9d949586eabad945cc341dab778615b` |
| [extensions/spec-driven-extended/skills/spec-driven-extended-meta-planning/SKILL.md](../../extensions/spec-driven-extended/skills/spec-driven-extended-meta-planning/SKILL.md) | изменён | `b12d639eeaf0a6f07f1e1914d53d59a1f4931ea86f906309eb1f5255819b4d68` |
| [extensions/spec-driven-extended/skills/spec-driven-extended-test-cases/SKILL.md](../../extensions/spec-driven-extended/skills/spec-driven-extended-test-cases/SKILL.md) | изменён | `193c7ed74e43e9a84bf5982c7b1c801ac359aa06c2d1e931fd25ddc6a1b5bce5` |
| [extensions/spec-driven-extended/subagents/spec-driven-extended-repository-evidence-scout.md](../../extensions/spec-driven-extended/subagents/spec-driven-extended-repository-evidence-scout.md) | изменён | `ffb2373785526095fa643bae4bd27e975f70fd6cc3e8bbdc61f569b761078f4b` |
| [extensions/superpowers/.claude-plugin/marketplace.json](../../extensions/superpowers/.claude-plugin/marketplace.json) | проверен | `94c5412f0039eeaa1f01c012d0bfe9613a817ff7211b4415d2da35ba900fd50a` |
| [extensions/superpowers/.claude-plugin/plugin.json](../../extensions/superpowers/.claude-plugin/plugin.json) | проверен | `475eecc40b42606656129d43d24c3ad9bedf43faeb3a85a8238988d59982f0da` |
| [extensions/superpowers/LICENSE](../../extensions/superpowers/LICENSE) | проверен | `a37e0e9697144819e1d965176ac4ae5bc3fa02d11e7812036bbcadf6dafe2400` |
| [extensions/superpowers/NOTICE.md](../../extensions/superpowers/NOTICE.md) | изменён | `ce37e84514e3f02f40780b3f05310f5133e7e9f2dca2af667d9d99e08a6bfbd8` |
| [extensions/superpowers/agent-instructions.md](../../extensions/superpowers/agent-instructions.md) | изменён | `36727e5ae8d232f09c1f7fbb20054775800a18e568d9a5bb2c1e372ee1635ebb` |
| [extensions/superpowers/extension.yaml](../../extensions/superpowers/extension.yaml) | проверен | `69608a3509acc944e7f71b901561607dc8dbce4e348fb30a4545d58a781571ed` |
| [extensions/superpowers/gigacode-extension.json](../../extensions/superpowers/gigacode-extension.json) | проверен | `71b92a628bd2d178d2b94164dbcb985d98822cbd196f0f177359ae371d5389dc` |
| [extensions/superpowers/hooks/hooks.json](../../extensions/superpowers/hooks/hooks.json) | изменён | `a1672c08c23e401c07abea9f9c4904eb10d685c6a25f94d74cb12c25f915d6e2` |
| [extensions/superpowers/hooks/session-start.js](../../extensions/superpowers/hooks/session-start.js) | изменён | `2af6eb26cb60f3b8369279f8b898d5c5e963ce842e83dcfa8a0aa2d84665f4cf` |
| [extensions/superpowers/qwen-extension.json](../../extensions/superpowers/qwen-extension.json) | проверен | `71b92a628bd2d178d2b94164dbcb985d98822cbd196f0f177359ae371d5389dc` |
| [extensions/superpowers/skills/brainstorming/SKILL.md](../../extensions/superpowers/skills/brainstorming/SKILL.md) | проверен | `281393f4c762917150e5bb6691f966c20026894a738e629b630c5d412db9e01c` |
| [extensions/superpowers/skills/brainstorming/scripts/frame-template.html](../../extensions/superpowers/skills/brainstorming/scripts/frame-template.html) | проверен | `6a8a4e58bd6a44b904e2e3c57de774481d909204597e1498de53f1b2fecc4c4e` |
| [extensions/superpowers/skills/brainstorming/scripts/helper.js](../../extensions/superpowers/skills/brainstorming/scripts/helper.js) | изменён | `9b371f24cbef4f50037ff43b6c955b387c34ad3d0f04fb99ea78a983d3a73452` |
| [extensions/superpowers/skills/brainstorming/scripts/server.cjs](../../extensions/superpowers/skills/brainstorming/scripts/server.cjs) | изменён | `f106d62e2f3d5bf07d1fce6f18393cce9302ca58f9f6ff2b1deed01417d81ef4` |
| [extensions/superpowers/skills/brainstorming/scripts/start-server.sh](../../extensions/superpowers/skills/brainstorming/scripts/start-server.sh) | изменён | `297b884d0b4eb05fb7b9561b9f6badc1dcd8841a5d33f7410338e1b71844476f` |
| [extensions/superpowers/skills/brainstorming/scripts/stop-server.sh](../../extensions/superpowers/skills/brainstorming/scripts/stop-server.sh) | изменён | `ccb4cff9c42636290f95ff47584c8f4608be36c027d8a4922ebc46165ed67513` |
| [extensions/superpowers/skills/brainstorming/spec-document-reviewer-prompt.md](../../extensions/superpowers/skills/brainstorming/spec-document-reviewer-prompt.md) | проверен | `95a0a195de9d984be2fffa95bab16fc8c563bc296a9cfc5e9c29cb3ece0d7457` |
| [extensions/superpowers/skills/brainstorming/visual-companion.md](../../extensions/superpowers/skills/brainstorming/visual-companion.md) | изменён | `603d6a7dd1da90c157c80d5a1e8b89591725f581613d3e2977dc2ff6e3edcd9e` |
| [extensions/superpowers/skills/dispatching-parallel-agents/SKILL.md](../../extensions/superpowers/skills/dispatching-parallel-agents/SKILL.md) | изменён | `d517d8e88163a0a7fd173173dbb86b37fb233f6236bf9d0278797e0ddb9705ed` |
| [extensions/superpowers/skills/executing-plans/SKILL.md](../../extensions/superpowers/skills/executing-plans/SKILL.md) | изменён | `4c7e8b54ac271d30ed56bac6b13a29fe1e589b428a9ea89ef126593e6215698c` |
| [extensions/superpowers/skills/finishing-a-development-branch/SKILL.md](../../extensions/superpowers/skills/finishing-a-development-branch/SKILL.md) | изменён | `ed97142b0cbaffb3338586975261c4aa9c4d393f977fe6c8ee6073af5cc3a1cf` |
| [extensions/superpowers/skills/receiving-code-review/SKILL.md](../../extensions/superpowers/skills/receiving-code-review/SKILL.md) | проверен | `647036bbdab7bf2317e14e079595e984c9030f64295e2b4c0fb57dbeb48f25dd` |
| [extensions/superpowers/skills/requesting-code-review/SKILL.md](../../extensions/superpowers/skills/requesting-code-review/SKILL.md) | изменён | `6f007d4be58bb5f704131c77514bb3e30f897a4b26c56c74aed00f3bed738828` |
| [extensions/superpowers/skills/requesting-code-review/code-reviewer.md](../../extensions/superpowers/skills/requesting-code-review/code-reviewer.md) | изменён | `fda6317acacb079b114de3d959a55ef68964b10a0866c125dcd4a6f8038eaebf` |
| [extensions/superpowers/skills/subagent-driven-development/SKILL.md](../../extensions/superpowers/skills/subagent-driven-development/SKILL.md) | изменён | `d4409d5f43f662c2476ad8832c642f6135d62a70218ac9e16635ab1778a9ec48` |
| [extensions/superpowers/skills/subagent-driven-development/implementer-prompt.md](../../extensions/superpowers/skills/subagent-driven-development/implementer-prompt.md) | изменён | `647bc817af691f6dda9035bf171abc4a95e24a188e5cdcf136e87aa18db534f4` |
| [extensions/superpowers/skills/subagent-driven-development/scripts/review-package](../../extensions/superpowers/skills/subagent-driven-development/scripts/review-package) | изменён | `3fa24f40c2aff53d1e870fec2a0dff61ac6c76ee201c1461e81dd4713266cc4b` |
| [extensions/superpowers/skills/subagent-driven-development/scripts/sdd-workspace](../../extensions/superpowers/skills/subagent-driven-development/scripts/sdd-workspace) | проверен | `58081e0273c11b83efde7fe0cb77566531681c2a846781fc567f0014d82744b8` |
| [extensions/superpowers/skills/subagent-driven-development/scripts/task-brief](../../extensions/superpowers/skills/subagent-driven-development/scripts/task-brief) | проверен | `8f1ae1edf737bd5bcf34f8e7882e35c0229ab0379b1a7e36b2bd8d1526e15c7e` |
| [extensions/superpowers/skills/subagent-driven-development/scripts/task-context.cjs](../../extensions/superpowers/skills/subagent-driven-development/scripts/task-context.cjs) | изменён | `1a576ab1361c3c926b115b00f5b22f7418ffffce9c3a4200e91844130392283f` |
| [extensions/superpowers/skills/subagent-driven-development/task-reviewer-prompt.md](../../extensions/superpowers/skills/subagent-driven-development/task-reviewer-prompt.md) | проверен | `2eb9d54373420de25bc0bd00635d3a3123a6c0eb30c881168e6f3348e2387331` |
| [extensions/superpowers/skills/systematic-debugging/SKILL.md](../../extensions/superpowers/skills/systematic-debugging/SKILL.md) | изменён | `710940cafe3ca85307f44c16312f8c761f12a71d4fc339b4f42cf1695f8899f5` |
| [extensions/superpowers/skills/systematic-debugging/condition-based-waiting-example.ts](../../extensions/superpowers/skills/systematic-debugging/condition-based-waiting-example.ts) | изменён | `ea2099161e4cd3b9df550235eb28a707fca03fb81aeba8d53882574b456b4e6f` |
| [extensions/superpowers/skills/systematic-debugging/condition-based-waiting.md](../../extensions/superpowers/skills/systematic-debugging/condition-based-waiting.md) | проверен | `e89fec8400d6cd50f43407cec9fab50976ba4d55d0ec2eb51c0bd68036b54c26` |
| [extensions/superpowers/skills/systematic-debugging/defense-in-depth.md](../../extensions/superpowers/skills/systematic-debugging/defense-in-depth.md) | изменён | `fcb2b1cdc2fd37c1595e753f84a9e6e49ffa15bb7a9efc6694f8b66f994e4ef6` |
| [extensions/superpowers/skills/systematic-debugging/find-polluter.sh](../../extensions/superpowers/skills/systematic-debugging/find-polluter.sh) | изменён | `d6c98d3f981d62e66209504c708aa3df936a1f4e981c17d575de877babe1b2d7` |
| [extensions/superpowers/skills/systematic-debugging/root-cause-tracing.md](../../extensions/superpowers/skills/systematic-debugging/root-cause-tracing.md) | изменён | `9f661394bb8e3cc5ece517bec4e432507e104a806525729558d573610c5ff107` |
| [extensions/superpowers/skills/systematic-debugging/test-academic.md](../../extensions/superpowers/skills/systematic-debugging/test-academic.md) | изменён | `3c85e6d13a014eb48f00aba1c262e934f086489153afb9bead9d153064727377` |
| [extensions/superpowers/skills/systematic-debugging/test-pressure-1.md](../../extensions/superpowers/skills/systematic-debugging/test-pressure-1.md) | изменён | `797d3b2f69b33678594284d24a5891b34f7e8e52757aeb9a6357df34e6111b7a` |
| [extensions/superpowers/skills/systematic-debugging/test-pressure-2.md](../../extensions/superpowers/skills/systematic-debugging/test-pressure-2.md) | изменён | `ebeeb5b5da5434b1959cebc0cec5bd5d1ff7be1528ae5d366987f430a92f5f3d` |
| [extensions/superpowers/skills/systematic-debugging/test-pressure-3.md](../../extensions/superpowers/skills/systematic-debugging/test-pressure-3.md) | изменён | `2dfc4f4a8c084709770ca68440da2e2846ef57fcf1ef77576d2040c589a096a7` |
| [extensions/superpowers/skills/test-driven-development/SKILL.md](../../extensions/superpowers/skills/test-driven-development/SKILL.md) | проверен | `b5b4717b8b761cce15a6cfe9022e33fd959e0894c0c39d72c9cb49c23486c10e` |
| [extensions/superpowers/skills/test-driven-development/testing-anti-patterns.md](../../extensions/superpowers/skills/test-driven-development/testing-anti-patterns.md) | проверен | `bde453bc258f06543987477c837939afaa774ea2acbd9f308d702fc452bc4283` |
| [extensions/superpowers/skills/using-git-worktrees/SKILL.md](../../extensions/superpowers/skills/using-git-worktrees/SKILL.md) | изменён | `514df7b2d50d9b01812864d4cbf62d7928b37ac87f2c5dbd7d17c1c25a4f7e55` |
| [extensions/superpowers/skills/using-superpowers/SKILL.md](../../extensions/superpowers/skills/using-superpowers/SKILL.md) | изменён | `54675e9afe41ec9801c54d637f0f3e1053d687d4c38406a6d4f9aafaad3a1588` |
| [extensions/superpowers/skills/verification-before-completion/SKILL.md](../../extensions/superpowers/skills/verification-before-completion/SKILL.md) | проверен | `ea52d15aabaf72bc6b558efe2c126f161b53961090ddcd712000273bfe8c7b6c` |
| [extensions/superpowers/skills/writing-plans/SKILL.md](../../extensions/superpowers/skills/writing-plans/SKILL.md) | изменён | `999a6a3fef014d9a4966dca21961d21770fd440f32decf1cbb4db9b3c9524922` |
| [extensions/superpowers/skills/writing-plans/plan-document-reviewer-prompt.md](../../extensions/superpowers/skills/writing-plans/plan-document-reviewer-prompt.md) | проверен | `aa728b96aad603c8be28875a4305637f6c984aa81ffcadcb13e743202fa2a0c7` |
| [extensions/superpowers/skills/writing-skills/SKILL.md](../../extensions/superpowers/skills/writing-skills/SKILL.md) | изменён | `30e07fde308b0d799907fb7d48d39dcede88151311ca6fee39b874195d01ec9b` |
| [extensions/superpowers/skills/writing-skills/anthropic-best-practices.md](../../extensions/superpowers/skills/writing-skills/anthropic-best-practices.md) | изменён | `212acbe604c6d5646496c90f50850a78bad5a3a4c92f720be4015c5c350abc8c` |
| [extensions/superpowers/skills/writing-skills/examples/CLAUDE_MD_TESTING.md](../../extensions/superpowers/skills/writing-skills/examples/CLAUDE_MD_TESTING.md) | проверен | `0b379a3415e185d3c434b3ad283d8aa132f3022c2a4f210f168865b5986bcef0` |
| [extensions/superpowers/skills/writing-skills/graphviz-conventions.dot](../../extensions/superpowers/skills/writing-skills/graphviz-conventions.dot) | проверен | `c1f7c34b361533d30d2e1b99e790319c1052fa46dbc85c14fc39930f966c07f8` |
| [extensions/superpowers/skills/writing-skills/persuasion-principles.md](../../extensions/superpowers/skills/writing-skills/persuasion-principles.md) | проверен | `a51bc9bf75189ea73a27b3fb504a2fdfdb966fb1f7f1cdf03203230a216ccc03` |
| [extensions/superpowers/skills/writing-skills/render-graphs.js](../../extensions/superpowers/skills/writing-skills/render-graphs.js) | изменён | `589499d401e2c5f1eec7cbb55f25de6aaed9bf5f8ff4b299666c7d788e427700` |
| [extensions/superpowers/skills/writing-skills/testing-skills-with-subagents.md](../../extensions/superpowers/skills/writing-skills/testing-skills-with-subagents.md) | изменён | `4fa4b7dd4916b28b8697bf8bd81ab657e168e69b21dc5b106cad889611fd4fcb` |
| [plugins/change-tracking/extension/.claude-plugin/marketplace.json](../../plugins/change-tracking/extension/.claude-plugin/marketplace.json) | проверен | `f5490fd64c9f8a58e801cf54e8c8f1f24f572d38d503bb128ba9308db396d5ca` |
| [plugins/change-tracking/extension/.claude-plugin/plugin.json](../../plugins/change-tracking/extension/.claude-plugin/plugin.json) | проверен | `a7b1a68d0a934fa50922890f745feda411cf1ce689c1ca38e53c3a3d4788cce8` |
| [plugins/change-tracking/extension/agent-instructions.md](../../plugins/change-tracking/extension/agent-instructions.md) | проверен | `2e332fc00a5aaa62460f5f4ac128a5052194defe694c24618fc01a2ba7a25782` |
| [plugins/change-tracking/extension/gigacode-extension.json](../../plugins/change-tracking/extension/gigacode-extension.json) | проверен | `e78dade8afd2e38848a987334eedb226f5787b53535450bc4a42ad3bcac99e5c` |
| [plugins/change-tracking/extension/hooks/hooks.json](../../plugins/change-tracking/extension/hooks/hooks.json) | проверен | `6a1e80ce35ce4f96b4e0011a7a21ac8739ddea78e07e2b2b106dad888f497ff7` |
| [plugins/change-tracking/extension/hooks/session-start.js](../../plugins/change-tracking/extension/hooks/session-start.js) | проверен | `4c05ef9964d80e77c9a008f2cfafc4a8a1506a0bb9c9203e731d707520ce650c` |
| [plugins/change-tracking/extension/qwen-extension.json](../../plugins/change-tracking/extension/qwen-extension.json) | проверен | `e78dade8afd2e38848a987334eedb226f5787b53535450bc4a42ad3bcac99e5c` |
| [plugins/codegraph/extension/.claude-plugin/marketplace.json](../../plugins/codegraph/extension/.claude-plugin/marketplace.json) | проверен | `b2fb56b894f364fadab1788de76fc175bc948bc43bff42ea8e01bf307ff0419c` |
| [plugins/codegraph/extension/.claude-plugin/plugin.json](../../plugins/codegraph/extension/.claude-plugin/plugin.json) | проверен | `5127cbc6cebbe1762ca8c3f4ce755943f9fe5f9d7d92459f761c7ea78a58e62d` |
| [plugins/codegraph/extension/.mcp.json](../../plugins/codegraph/extension/.mcp.json) | проверен | `6f0c60bded766cfba782aace40cdd332ca1acbaeae657e42d9904c75cc70bfe9` |
| [plugins/codegraph/extension/agent-instructions.md](../../plugins/codegraph/extension/agent-instructions.md) | проверен | `fd17186ab6c2c33488e37cdfc8589cebb70689e97caaf6d4f2347a0ab7f023f9` |
| [plugins/codegraph/extension/gigacode-extension.json](../../plugins/codegraph/extension/gigacode-extension.json) | проверен | `e228bd56f1a5ef4da2334fe5d2fa333f46dc4234e4dd4e30ba1c8f85ef8d1b8b` |
| [plugins/codegraph/extension/hooks/hooks.json](../../plugins/codegraph/extension/hooks/hooks.json) | проверен | `6a1e80ce35ce4f96b4e0011a7a21ac8739ddea78e07e2b2b106dad888f497ff7` |
| [plugins/codegraph/extension/hooks/session-start.js](../../plugins/codegraph/extension/hooks/session-start.js) | проверен | `038dee516ba05262c81b9f60a94aa82cd4e52a33fd96b577c720c7640dc34493` |
| [plugins/codegraph/extension/qwen-extension.json](../../plugins/codegraph/extension/qwen-extension.json) | проверен | `e228bd56f1a5ef4da2334fe5d2fa333f46dc4234e4dd4e30ba1c8f85ef8d1b8b` |
| [plugins/openspec-graph/lib/agent.js](../../plugins/openspec-graph/lib/agent.js) | проверен | `e88a36db530677574c17231b863c0b14b019f4e05d86ab98168b9af8d3b70aaa` |
| [templates/default/assets/STORE.md](../../templates/default/assets/STORE.md) | проверен | `23965a2e404da5046de37aa51d58b77dfb3e7627ab71daf8d29a92e020b356d2` |
| [templates/default/assets/agent-instructions.md](../../templates/default/assets/agent-instructions.md) | проверен | `4324c80759e90b554b5434dcde791185454dfadd9387a36367a21e0021f2eccf` |
| [templates/default/assets/gitignore.template](../../templates/default/assets/gitignore.template) | проверен | `0ba5c31858adcc9be7bc81465f6e15af11bb787a1e6614d9afad6acad6cbef41` |
| [templates/default/context/00-start-here.md](../../templates/default/context/00-start-here.md) | изменён | `5844c7eb657e92a7fee3308a0c6c8347dd432a31fcc0eb7dc760ac9eebd1946f` |
| [templates/default/context/01-product-context.md](../../templates/default/context/01-product-context.md) | проверен | `86e01cbf013cc62ac623ff5bf4f2c7b83504e84d4dce98268c55325405fa2924` |
| [templates/default/context/02-domain-glossary.md](../../templates/default/context/02-domain-glossary.md) | проверен | `365859527a9bd5c27bd55b22663da2a3b2d055b0f1312a8162957345a0957c17` |
| [templates/default/context/03-architecture.md](../../templates/default/context/03-architecture.md) | проверен | `718b7bc2f6534faad99fa1a26b53150e0b68a4e9473af30ac4d8d237e68c73a8` |
| [templates/default/context/04-domain-model.md](../../templates/default/context/04-domain-model.md) | проверен | `ae0cced78ad751f296138625e12c3a0c08180e761728d3d2f394bf1fa791c56f` |
| [templates/default/context/05-security-and-compliance.md](../../templates/default/context/05-security-and-compliance.md) | проверен | `8b4ad629a61e20108d7dcaad808183885d25eb2cf49f25017f9dd81531a574a1` |
| [templates/default/context/06-cross-system-invariants.md](../../templates/default/context/06-cross-system-invariants.md) | изменён | `a0a14aeb43ad98c9a096b787854a34c3962b24d9c14b07a8b46413c2e80eb8cf` |
| [templates/default/context/07-quality-gates.md](../../templates/default/context/07-quality-gates.md) | изменён | `8907c0747cf2a49b359b05609099c77dd511e889f3202000c49cb363516058a7` |
| [templates/default/context/08-release-process.md](../../templates/default/context/08-release-process.md) | проверен | `3ed8fafbf37e94bc2efe08f7408b096b8cb3e07fde45c20e26193213b555fd8f` |
| [templates/default/context/ADR/README.md](../../templates/default/context/ADR/README.md) | изменён | `df25c16b64dcc8a65405866cf640889e49755632abdcff7b24ba82f703f942fe` |
| [templates/default/context/_raw/README.md](../../templates/default/context/_raw/README.md) | проверен | `5129e147fda3c2e77b9f71c39993a07395e1c3d82a6803eeb5bd2b9c76762b70` |
| [templates/default/openspec/config.yaml](../../templates/default/openspec/config.yaml) | изменён | `aafc8112cbb6595b4c3bc5db050239922e8d84619103905bc707e545ef1223ab` |
| [templates/default/openspec/schemas/spec-driven-extended/schema.yaml](../../templates/default/openspec/schemas/spec-driven-extended/schema.yaml) | изменён | `6109968e1fd215934357526e9158d9271e232af23fab474bd1695b47797d133b` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/design.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/design.md) | изменён | `26c018f7acd536d8d87e4a1603754d1babf8ca732f1272d7a1d220e51127d55b` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/intake.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/intake.md) | проверен | `a9f899bea28f3430757ec9b4530730f2870188d3b43846275ccf5c2797fbde1e` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/proposal.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/proposal.md) | проверен | `e9c15e8123ebc191dd9af362b91edd663bba28d1d45de1b36bcf441468c0b0e4` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/spec.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/spec.md) | изменён | `f9ee428d658ef43ca3008c595d5b665fe87c190d7db77a57e242b8926cf40ac4` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/tasks.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/tasks.md) | изменён | `ec78180e66721b96ad3efc31af1f0a7cd1e08ab0e3f5c748279626f55091c6ad` |
| [templates/default/openspec/schemas/spec-driven-extended/templates/verify.md](../../templates/default/openspec/schemas/spec-driven-extended/templates/verify.md) | проверен | `10e19b798cf470936b953fd58a96db4e4681bd7e2fe84e55e38b5c5dcb08173d` |
| [templates/default/openspec/schemas/superspec-multirepo/INTEGRATION.md](../../templates/default/openspec/schemas/superspec-multirepo/INTEGRATION.md) | проверен | `8aa8bd9221f0bc3a2fce1400fe7e2e89ee56bee84a44bf38796f168096e5737d` |
| [templates/default/openspec/schemas/superspec-multirepo/LICENSE.upstream](../../templates/default/openspec/schemas/superspec-multirepo/LICENSE.upstream) | проверен | `4904e74b0083784173b7ec8b6534919bc1a5e57b1c392397804f74ca165d8791` |
| [templates/default/openspec/schemas/superspec-multirepo/NOTICE.md](../../templates/default/openspec/schemas/superspec-multirepo/NOTICE.md) | проверен | `80eb51444041c08943704b6fb033cef9583fe191fb43f78aa029adf0d52c831f` |
| [templates/default/openspec/schemas/superspec-multirepo/README.md](../../templates/default/openspec/schemas/superspec-multirepo/README.md) | проверен | `9ce7c12f34ff3c6aaa0d1f2c0915286ac00b573ef3736005507734fa0152fc40` |
| [templates/default/openspec/schemas/superspec-multirepo/schema.yaml](../../templates/default/openspec/schemas/superspec-multirepo/schema.yaml) | изменён | `0ebddc572b0be6db47c13e2dfe7787d10e8968f7ba37f0e3c4442b54b8200777` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/brainstorm.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/brainstorm.md) | проверен | `3a3d797ae07518a9afb21a8ed20ea11dc058ca8182fa722eff7ea32b25542bc8` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/design.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/design.md) | проверен | `efe0400da5b35e957503f8ad1ca50f064016aede98d4a64e1644be797b5c3108` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/plan.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/plan.md) | проверен | `270c509dceab52a5cc8b7f1e783bf75a3ad872dd33a3087abf2c20f5356e69b0` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/proposal.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/proposal.md) | проверен | `0892b49b01ccb97bc42dbb708eb6099f6a424827c27a275def3f3bd380549504` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/spec.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/spec.md) | изменён | `ca39e59912c67c139e69ec141cc21945e9385a397defdb51c39b5ef248e77481` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/tasks.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/tasks.md) | изменён | `eeabd4e17e99f925ea07433bdd16d3318691dc00b312597db2af25a06e702899` |
| [templates/default/openspec/schemas/superspec-multirepo/templates/verify.md](../../templates/default/openspec/schemas/superspec-multirepo/templates/verify.md) | проверен | `9123c29cb2c9c517d26722351747050994f17ec1f3175212793a8b5149d38e71` |
| [templates/default/template.yaml](../../templates/default/template.yaml) | проверен | `ced6148f10ac6c6f636722747f4a62fa951a974b407b18937e353c13625fd636` |
