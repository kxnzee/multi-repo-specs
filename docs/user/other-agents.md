# Claude и Qwen

Вся документация написана для GigaCode. Orchestrator поддерживает также Claude и
Qwen. Порядок работы тот же, отличаются только имена:

| Что | GigaCode | Qwen | Claude |
|---|---|---|---|
| Значение `--agent` | `gigacode` | `qwen` | `claude` |
| Запуск клиента | `gigacode` | `qwen` | `claude` |
| Команды OpenSpec | `/opsx-apply` | `/opsx-apply` | `/opsx:apply` |
| Бизнес-контекст | `/project-context` | `/project-context` | `/project-context:project-context` |
| Файл инструкций | `<workspace>/specs/GIGACODE.md` | `<workspace>/specs/QWEN.md` | `<workspace>/specs/CLAUDE.md` |

Остальные команды OpenSpec меняются по тому же правилу: в Claude вместо дефиса
после `opsx` ставится двоеточие (`/opsx:continue`, `/opsx:verify`, `/opsx:archive`).

Агент выбирается при `init` и записывается в `<workspace>/specs/openspec-orch.yaml`. Все
участники проекта используют одного агента.
