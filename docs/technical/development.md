# Разработка Orchestrator Core

Этот документ описывает границы исходного кода и минимальные проверки для
разработчиков Orchestrator. Пользователям CLI он не нужен.

## Границы кода

- `src/cli/program.js` — публичная грамматика CLI;
- `src/cli/commands/` — интерактивные пользовательские сценарии и вывод;
- `src/internal/cycle/` — Cycle Record и `status`;
- `src/internal/receipt/`, `snapshot/`, `state/` — локальные результаты и Snapshot;
- `src/internal/init/`, `connect/`, `config/` — bootstrap и реестр репозиториев;
- `src/internal/shared/` — Git, OpenSpec, filesystem и process-примитивы;
- `templates/base/` — Project Template, используемый только при `init`;
- `test/` — unit- и интеграционные проверки на временных Git-репозиториях.

Публичного JavaScript API нет: поддерживаемая поверхность — CLI `openspec-orch`.

## Добавление агента

Поддержка нового агента добавляется без изменения Core:

- добавьте mapping в `templates/base/template.yaml`;
- копируйте совместимые канонические файлы напрямую, а несовместимые адаптируйте в
  `templates/base/adapters/<agent-id>/`;
- обновите только `docs/user/supported-agents.md` и универсальные тесты Template,
  не добавляя отдельный реестр или тестовые ветвления по agent id;
- проверьте `openspec-orch init` и обнаружение instructions, project skill и
  subagent в нативном runtime. Если runtime недоступен, не объявляйте поддержку
  проверенной.

## Проверки

```bash
npm run check
git diff --check
node src/bin/openspec-orch.js --help
```

До завершения пилота правила заморозки Core определены в `AGENTS.md`, а
кандидаты развития записываются в `BACKLOG.md`.
