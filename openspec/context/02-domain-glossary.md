---
owner: Product Owner
updated: 2026-08-03
---

# Глоссарий

| Термин | Значение |
|---|---|
| **Change** | Одно изменение: `proposal.md` + `specs/` (дельта) + `impact-and-design.md` + `tasks.md` + `verification.md` в `changes/<change-id>/` |
| **Master Specs** | Утверждённые требования области после финализации — источник истины |
| **Delta Specs** | Требования и сценарии, предлагаемые изменением, до применения к Master Specs |
| **Work Package** | Единица работы для одного репозитория внутри Change. Тип `implements` (реализует сценарии) или `enables` (технически необходим, сценариев не имеет) |
| **AC-\*** | Acceptance Criteria — технический критерий приёмки для Work Package типа `enables` |
| **Scenario ID** | Стабильный идентификатор сценария в Delta Specs, используется в трассировке до тест-кейсов |
| **Baseline** | Аннотированный git-тег `spec-baseline/<change-id>/v<N>`, фиксирующий ревизию требований для кодовых репозиториев |
| **Fixture-Change** | Тестовое изменение (`_load-fixture`) для приёмки `sdd load` без реального Baseline. Не архивируется |
| **candidate_repositories** | Поле в черновике `impact-and-design.md` — единственный источник списка для `fetch-repos` |
| **read-log.md** | Таблица «репозиторий → ревизия → дата» с найденными ограничениями по каждому прочитанному репозиторию |
| **Effective Specs** | Проекция Master Specs + активных изменений. При одном активном Change тождественна Master Specs (отложено до Scale Profile) |
| **Spec Owner** | Владелец процесса требований; в пилоте обязателен заместитель |
| **Release Owner** | Отвечает за пакет `enables` и карточку изменения в `configuration` |
| **HARD / WAIVABLE / INFO** | Классы пунктов чек-листа: блокирует старт / допускает старт с зафиксированным риском / не влияет на решение |
