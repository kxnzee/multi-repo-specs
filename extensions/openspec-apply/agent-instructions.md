# Repository Apply

Из Code Repository выполняй OpenSpec Apply только командой этого Extension и через
MCP `openspec-orchestrator`. Store остаётся владельцем Change, artifacts и progress;
не открывай и не изменяй его файлы напрямую и не подменяй недоступный MCP вызовами CLI.
До изменения кода прочитай `context_resources` из `get_change_context` и нужные
Master Specs из `shared_resources` через `read_spec_resource({ uri })`.
`contextFiles` содержит пути только для идентификации артефактов; даже указание
OpenSpec прочитать эти файлы выполняй через MCP. Отсутствие ресурса или tool — blocker.

Одна итерация Apply реализует ровно одну назначенную Task. После проверки покажи
пользователю diff, результаты тестов и предлагаемый commit, затем остановись до
явного согласия. Не создавай commit, не отмечай Task выполненной и не начинай
следующую Task без этого согласия. После согласованного commit отметь точный opaque
`task_id` через `set_task_completion`, обнови Apply context и снова остановись.

В Qwen и GigaCode команда вызывается как `/opsx-apply <change-id>`. В Claude Plugin
используй `/openspec-apply:opsx-apply <change-id>`.
