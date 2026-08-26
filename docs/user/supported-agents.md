# Поддерживаемые агенты

Это единственный пользовательский список значений `openspec-orch init --agent`.
Остальной процесс и документация используют общее слово «агент».

| `--agent` | OpenSpec adapter | Инструкции | OpenSpec commands | Project commands | Skills | Subagents |
|---|---|---|---|---|---|---|
| `qwen` | `qwen` | `QWEN.md` | `.qwen/commands/` | `.qwen/commands/` | `.qwen/skills/` | `.qwen/agents/` |
| `gigacode` | `qwen` | `GIGACODE.md` | `.gigacode/commands/` | `.gigacode/commands/` | `.gigacode/skills/` | `.gigacode/agents/` |
| `claude` | `claude` | `CLAUDE.md` | `.claude/commands/opsx/` | `.claude/commands/` | `.claude/skills/` | `.claude/agents/` |

Формат Qwen/GigaCode является эталоном Project Template. Для остальных агентов
mapping использует прямое копирование совместимых файлов и адаптированные артефакты
только для несовместимых нативных форматов.

`QWEN.md`, `GIGACODE.md` и `CLAUDE.md` устанавливаются в корень Store. Служебные
commands, skills и subagents остаются в provider-specific каталогах из таблицы.

Базовый Template устанавливает две project commands:

- `/openspec-base-intake` — адаптивный опрос и сборка `intake.md`;
- `/openspec-base-context` — initialize/audit/update долговечного context и ADR,
  включая scoped audit по Change, Master Specs или domain.

У Claude они лежат уровнем выше каталога официальных `opsx` commands; это не изменяет
и не перемещает команды, созданные штатным `openspec init`. Template применяется
только во время `init`, поэтому уже созданный Store не получает новые версии project
commands автоматически.
