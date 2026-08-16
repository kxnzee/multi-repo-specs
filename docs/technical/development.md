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

## Проверки

```bash
npm run check
git diff --check
node src/bin/openspec-orch.js --help
```

До завершения пилота правила заморозки Core определены в `AGENTS.md`, а
кандидаты развития записываются в `BACKLOG.md`.
