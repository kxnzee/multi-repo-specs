---
owner: Spec Owner
updated: 2026-08-03
---

# Старт

Этот репозиторий (`project-specs`) — центральное хранилище Master Specs и активных изменений для пилота Pilot Core.

**Профиль:** Pilot Core, ред. 1.1 (см. `.claude/Profil-Pilot-Core-1.1.md`).
**Регламент-источник:** SDD и OpenSpec, ред. 3.5.4 (см. `.claude/SDD-OpenSpec-3.5.4.md`).
**План подготовки:** `.claude/Plan-podgotovki-Pilot-Core-1.1.md`.
**Прогресс:** `.claude/Pilot-Core-Implementation-Tracker.md`.

## Что делать первым

1. Прочитать `openspec/context/02-domain-glossary.md` — термины, которые используются без расшифровки везде дальше.
2. Прочитать `openspec/context/03-architecture.md` — состав репозиториев, их роли и архитектурные правила.
3. Прочитать `openspec/context/system-map.yaml` — машиночитаемую карту систем и связей.
4. Смотреть `openspec/context/09-scenario-prefixes.md` перед выдачей нового Scenario ID.
5. Образец Delta Spec находится в `openspec/context/examples/sample-requirement.md`.

## Границы пилота (напоминание)

Ровно одно активное изменение, одна capability, межрепозиторное аддитивное, без ПДн/прав доступа/денег/внешних интеграций, реализация 3–5 дней. Нарушение любого условия — переход на Scale Profile, не продолжение по Pilot Core.
