# Поддерживаемые агенты

Это единственный пользовательский список значений `openspec-orch init --agent`.
Остальной процесс и документация используют общее слово «агент».

| `--agent` | OpenSpec adapter | Инструкции | Commands | Skills | Subagents |
|---|---|---|---|---|---|
| `qwen` | `qwen` | `QWEN.md` | `.qwen/commands/` | `.qwen/skills/` | `.qwen/agents/` |
| `gigacode` | `qwen` | `.gigacode/GIGACODE.md` | `.gigacode/commands/` | `.gigacode/skills/` | `.gigacode/agents/` |
| `claude` | `claude` | `CLAUDE.md` | `.claude/commands/opsx/` | `.claude/skills/` | `.claude/agents/` |

Формат Qwen/GigaCode является эталоном Project Template. Для остальных агентов
mapping использует прямое копирование совместимых файлов и адаптированные артефакты
только для несовместимых нативных форматов.
