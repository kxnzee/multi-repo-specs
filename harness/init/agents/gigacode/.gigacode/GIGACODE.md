# Инструкции для GigaCode

## Маршрутизация завершённого Planning

<!--
Этот короткий override нужен в любой сессии: built-in `/opsx-continue` в ветке
`isComplete: true` завершает работу до вызова `openspec instructions` и поэтому не получает
маршрутизацию проекта из `openspec/config.yaml`.
-->

- Если шаг 03 начинается в новой сессии, до первого `/opsx-continue` покажи Change Owner полный `proposal.md` и получи явное подтверждение, что это принятый вход. Не выводи подтверждение из наличия файла или статуса OpenSpec `done`. Не создавай для этого approval-файл и не повторяй Explore, если scope и исходные факты не изменились.
- `isComplete: true` после `/opsx-continue` означает только завершение Proposal, Specs, Design и Tasks, а не готовность реализации.
- В этой ветке замени предложение built-in перейти к `/opsx-apply` или `/opsx-archive` единственным маршрутом: шаг 04, Planning PR и фиксация Spec Baseline. Сам Apply или Archive не запускай.
