# Superpowers bootstrap

В этом Extension доступна нативная библиотека навыков Superpowers. До ответа или действия проверь, подходит ли к задаче один из навыков в `skills/`, и используй штатный механизм навыков текущего Agent.

Основная маршрутизация:

- новая функция или изменение поведения — `brainstorming`, затем `writing-plans`;
- выполнение готового плана — `executing-plans` или `subagent-driven-development`;
- исправление дефекта — `systematic-debugging`;
- реализация через тесты — `test-driven-development`;
- запрос или обработка ревью — `requesting-code-review` / `receiving-code-review`;
- перед заявлением о готовности — `verification-before-completion`;
- завершение ветки — `finishing-a-development-branch`;
- создание навыка — `writing-skills`.

Пользовательские и проектные инструкции имеют приоритет над навыками. Полный bootstrap-контракт находится в `using-superpowers`; не копируй содержимое навыков в проект и не загружай их из сети.
