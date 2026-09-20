# Project Context

Extension `project-context` предоставляет команду сбора и обновления долговечного
бизнес-контекста центрального Store. Команда не зависит от schema и не запускает
этапы Change.

Template `default` и `initiative` создают одинаковый каркас `openspec/context/`
и требуют этот Extension. Template владеет копируемыми документами, Extension —
процедурой работы агента с ними.

Команды и правила наполнения описаны в
[руководстве по контексту проекта](../user/project-context.md). Исходные манифесты
и инструкции находятся в `extensions/project-context/`.
