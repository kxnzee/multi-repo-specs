## Change Tracking

Change Tracking подключён к текущему Store. Для штатного Apply используй
`openspec-base-apply-context`: он передаст Change Tracking-часть preflight в skill
`change-tracking-apply-context`. Не запускай этот leaf skill вместо общего entrypoint.

Cycle, planning revision, repository-scoped Tasks, Receipts и Snapshot проверяются
только по правилам `change-tracking-apply-context`. Не создавай Cycle и не выбирай
standard/orchestrated mode без явного решения пользователя.
