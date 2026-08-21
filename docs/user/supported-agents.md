# Поддерживаемые агенты

Это единственный пользовательский список значений `openspec-orch init --agent`.
Остальной процесс и документация используют общее слово «агент».

| `--agent` | OpenSpec adapter | Инструкции | OpenSpec commands | Project commands | Skills | Subagents |
|---|---|---|---|---|---|---|
| `qwen` | `qwen` | `QWEN.md` | `.qwen/commands/` | `.qwen/commands/` | `.qwen/skills/` | `.qwen/agents/` |
| `gigacode` | `qwen` | `.gigacode/GIGACODE.md` | `.gigacode/commands/` | `.gigacode/commands/` | `.gigacode/skills/` | `.gigacode/agents/` |
| `claude` | `claude` | `CLAUDE.md` | `.claude/commands/opsx/` | `.claude/commands/` | `.claude/skills/` | `.claude/agents/` |

Формат Qwen/GigaCode является эталоном Project Template. Для остальных агентов
mapping использует прямое копирование совместимых файлов и адаптированные артефакты
только для несовместимых нативных форматов.

В базовом Template единственная project command — `/openspec-base-context`. У Claude
она лежит уровнем выше каталога официальных `opsx` commands; это не изменяет и не
перемещает команды, созданные штатным `openspec init`.
