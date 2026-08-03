# Impact and Design: load-fixture

## Candidate Repositories

```yaml
candidate_repositories: [ui, backend]
```

`configuration` не входит в кандидатов для `fetch-repos` (раздел 7 профиля Pilot Core) — участвует через Work Package напрямую.

## Read Log

Фикстура не требует чтения соседних репозиториев по существу — `ui` и `backend` в этом упражнении не читаются, `fetch-repos` для fixture-Change не запускался. См. `templates/impact-and-design.schema.md`: read-log ведётся только при реальном чтении.

## Confirmed Repositories

`ui`, `backend`, `configuration` — все три из-за Work Packages в `tasks.md`. Кандидатами для `fetch-repos` были только `ui`/`backend`; `configuration` подтверждён напрямую, без чтения (раздел 7 профиля).

## Contracts

Контрактов между репозиториями нет — фикстура изолирована, тестовое событие backend не потребляется UI напрямую.

## Design

Новых межрепозиторных решений нет.

## Deployment and Rollout

Не разворачивается — фикстура существует только для приёмки `sdd load`, не мержится дальше Planning PR и не архивируется.

## Rollback

Отката нет: изменение не применяется к Master Specs, каталог удаляется отдельным коммитом после приёмки.
