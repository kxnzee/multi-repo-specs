# Работа с контекстом проекта

Для сбора и обновления долговечного бизнес-контекста центрального Store используй
команду `/project-context`. Она работает независимо от schema и не требует Change.

В Qwen и GigaCode команда вызывается как `/project-context`. В Claude Plugin
добавляет namespace: `/project-context:project-context`.

Контекст хранится в `openspec/context/`. Исходные материалы из `_raw/` служат
входом для сбора, а устойчивые разделы и ADR остаются самодостаточными.
