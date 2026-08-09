---
description: "Выполнение одного Work Package SDD в пределах репозитория"
---

Первое сообщение всегда начни на русском языке. Всегда общайся с пользователем на русском языке. На русском формулируй вопросы, пояснения, промежуточные итоги, описания diff и финальный отчёт. Не переходи на английский из-за англоязычных исходников. Не переводи только код, команды, пути, идентификаторы, имена полей и обязательные машинные значения.

Эта инструкция создаётся на шаге 00 и используется только после успешного `sdd load` на шаге 05. Новая агентская сессия запускается из корня целевого Code Repository готовым первым сообщением `next_action`, которое содержит точный путь к этому файлу и параметры:

```text
--store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>...
```

Используй тот же набор значений, который был передан в успешный `sdd load`. Из корня Code Repository определи workspace по стандартному пути `<workspace>/src/<repository-id>` и открой runtime напрямую: `<workspace>/.sdd/runtime/<store-id>/<change-id>/<repository-id>/context.json`. Не ищи context по glob, не вычисляй Store, repository, Baseline или Work Packages автоматически, не запускай `sdd load` и не требуй дополнительную команду подготовки.

Прекрати выполнение, если обязательный параметр отсутствует или повторён; runtime отсутствует, имеет неизвестную структуру или не содержит `step_status: implementation_ready`; переданные Store, repository, Change, Baseline или Work Packages не совпадают с context; cwd не равен `code_root`; текущая ветка не равна `implementation_branch`; HEAD не является потомком `code_base_revision`; `allowed_edit_roots` не равен только текущему Code Repository; `immutable_roots` не равен только `spec_root`; worktree изменён либо его HEAD не равен `spec_baseline`.

Из `spec_root` повтори штатные `openspec validate <change-id> --type change --strict --no-interactive --json` и `openspec instructions apply --change <change-id> --json`. Используй только перечисленные в runtime Work Package ID и сопоставляй их с точными `tasks[].id` официального ответа. Не копируй описания Tasks в runtime, не извлекай ID и не выводи назначение репозиторию из свободного текста.

Реализуй только назначенные Work Packages в пределах `allowed_edit_roots`. Сначала ищи технический Knowledge Pack в provider-specific каталоге агента текущего Code Repository; при отсутствии достаточной документации читай код адресно. Не загружай весь репозиторий или другие Code Repositories автоматически. Покажи diff кода и выполни проверки репозитория. После работы снова проверь чистоту и точную SHA immutable Store worktree; любое его изменение блокирует продолжение и требует воспроизведения через `sdd load`.

Не изменяй центральный `tasks.md`, не додумывай работу другого репозитория и не расширяй область записи на основании истории диалога.
