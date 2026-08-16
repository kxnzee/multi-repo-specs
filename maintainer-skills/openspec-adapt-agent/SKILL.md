---
name: openspec-adapt-agent
description: Адаптировать базовый OpenSpec Project Template для нового агента или проверить существующий agent mapping. Использовать при добавлении поддержки нового агента, изменении его нативных путей или форматов commands, skills, subagents и постоянных инструкций.
---

# Адаптация агента

Добавляй поддержку агента через данные Project Template. Не изменяй Orchestrator
Core, встроенные OpenSpec `openspec-*` skills и `opsx-*` commands.

## Эталон

Считай каноническим контрактом формат Qwen/GigaCode:

- `templates/base/agent-instructions.md` — постоянные инструкции;
- `templates/base/skills/*/SKILL.md` — project skills;
- `templates/base/subagents/*.md` — read-only subagents;
- штатный OpenSpec adapter — источник `opsx-*` commands.

Не создавай копию канонического файла, если агент умеет загрузить его напрямую из
своего нативного пути.

## Порядок работы

1. Прочитай `templates/base/template.yaml` и перечисли уже поддерживаемые mappings.
2. По официальной документации и установленному runtime определи:
   `openspec_adapter`, generated/target directory, каталог commands, основной
   instruction-файл, каталоги skills и subagents.
3. Проверь каждый канонический тип артефакта на совместимость с нативным форматом.
4. Добавь один mapping в `templates/base/template.yaml`.
5. Для совместимых артефактов используй прямой `copy` из канонического источника.
6. Только несовместимые артефакты преобразуй в
   `templates/base/adapters/<agent-id>/`. Сохраняй имена и Markdown-body; изменяй
   лишь обязательный нативный синтаксис, frontmatter и названия инструментов.
7. Не добавляй имя агента в общие пользовательские документы или тестовые ветвления.
   Обнови только `docs/user/supported-agents.md`.
8. Запусти универсальные проверки и изолированный `openspec-orch init` с новым id.
9. Через нативный runtime проверь обнаружение instruction-файла, одного project
   skill, одного subagent и read-only ограничений. Самоописание агента не считается
   проверкой.

## Критерии результата

- `template.yaml` остаётся единственным реестром agent mappings.
- В `test-fixtures/` нет копии реестра.
- Общие тесты перебирают mappings из `template.yaml` и не содержат условия по id.
- Адаптированный subagent сохраняет тело соответствующего канонического профиля.
- Команды создаёт штатный OpenSpec adapter; Template их не дублирует.
- Если runtime или авторизация недоступны, пометь native smoke как `не выполнен` и
  не объявляй поддержку проверенной.
