<!--
Шаблон Code PR для Pilot Core.
Источник: I.19.1 (состав описания, дословно) и I.19.2 (проверки) регламента 3.5.4;
«Профиль Pilot Core» ред. 1.1, раздел 4 (правила 4, 5) и раздел 8 (Baseline).
Копируется в описание PR в кодовом репозитории (ui, backend, configuration).
-->

## Specification

Дублирует карточку изменения человекочитаемо (I.19.1) — не редактируется вручную отдельно от `.sdd/change.yaml`, только копируется из него:

- **Change ID:** `<change-id>`
- **Baseline:** `<spec-baseline/change-id/vN>`
- **Ревизия:** `<spec_revision из .sdd/change.yaml>`
- **Репозиторий:** `<ui | backend | configuration>`
- **Work Packages:** `<id из tasks.md>`
- **Scenario ID:** `<для implements — список; для enables — не заполняется, см. AC-* ниже>`

## Local Design
Ссылка на файл репозитория (не на PR, не на комментарий) — `<path/to/local-design.md>`

## Implementation Plan
Ссылка на файл репозитория — `<path/to/implementation-plan.md>`

## Dependencies
<Другие Code PR или внешние условия, от которых зависит этот PR — или явно «Нет»>

## Deviations
<Фактические отклонения от Local Design/Implementation Plan — или явно «Нет». Системное отклонение (меняющее наблюдаемое поведение против центрального изменения) скрывать в Code PR нельзя — I.19.2>

## Tests
<Какие тесты добавлены/обновлены под затронутые Scenario ID>

## Verification Evidence
<Результат прогона, ссылка на CI>

## Классификация изменения

Дословно по I.19.1 — три поля, без замены на другие термины:

- **Business behavior change:** Yes / No
- **API contract change:** Yes / No
- **Master Spec update:** Required / Not required

---

## Чек-лист проверок Code PR (I.19.2)

| Что проверяется | Кто сейчас | Отмечено |
|---|---|---|
| Карточка изменения `.sdd/change.yaml` присутствует и заполнена | Tech Lead | ☐ |
| Изменение существует в центральном хранилище — среди активных или отменённых | Tech Lead | ☐ |
| Baseline-тег существует, аннотированный, имя по шаблону `spec-baseline/<change-id>/v<N>` | Tech Lead / `sdd check --code` | ☐ |
| Коммит тега достижим из основной ветки central | `sdd check --code` | ☐ |
| `spec_revision` в карточке совпадает с фактической ревизией тега | `sdd check --code` | ☐ |
| Work Package назначен именно этому репозиторию | Tech Lead | ☐ |
| Scenario ID существуют в изменении | Tech Lead | ☐ |
| Ссылки на Local Design и Implementation Plan ведут на файлы репозитория (не на PR/комментарий) | Tech Lead | ☐ |
| Собственный корень OpenSpec (`openspec/config.yaml`, `openspec/specs`, `openspec/changes`) в этом репозитории отсутствует | Tech Lead по diff / `sdd check --code` | ☐ |
| Необходимые тесты выполнены и зелёные | Сборка репозитория | ☐ |
| При `Business behavior change: Yes` центральное изменение обновлено | Tech Lead, только человек | ☐ |
| Системное отклонение не скрыто в Code PR | Tech Lead, только человек | ☐ |
| Пре-коммит-хук не отключался | Разработчик | ☐ |

**Правило 5 без исключений.** `configuration` — полноправный участник (раздел 1 профиля Pilot Core), а не расширение `project-specs`; собственного корня OpenSpec там быть не должно точно так же, как в `ui`/`backend`.

## Только для Work Package типа `enables`

- [ ] Технический критерий (`AC-*`) выполнен и отмечен
- [ ] Scenario ID в этом Work Package нет и не должно быть (I.16.1)
- [ ] Защитный критерий флага получил `Verified` до раскатки в production (I.16.2)
