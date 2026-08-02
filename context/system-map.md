# Карта системы

Как области требований соотносятся с репозиториями и пакетами работ в пилоте.

```text
Область (Master Specs, project-specs)
  │
  ├─ Delta Specs изменения (changes/<change-id>/specs/)
  │     └─ Scenario ID ──────────────┐
  │                                  │
  ├─ Work Package: ui        (implements) ── связан со Scenario ID
  ├─ Work Package: backend   (implements) ── связан со Scenario ID
  └─ Work Package: configuration (enables) ── связан с AC-* (без Scenario ID)
```

## Поток одного изменения

1. Требование формулируется в `project-specs` как Delta Spec со стабильным Scenario ID.
2. `impact-and-design.md` называет кандидатов (`candidate_repositories`), затем подтверждает состав после чтения.
3. `tasks.md` создаёт Work Packages: `ui`/`backend` получают `implements`, `configuration` — `enables` с техническим критерием защиты флага.
4. После Baseline каждый репозиторий выполняет `sdd load <change-id>`:
   - `ui`, `backend` — получают выжимку требований и связанных сценариев;
   - `configuration` — получает условие готовности, список зависимых пакетов и `AC-*`, без сценариев.
5. Реализация идёт по Local Design в каждом репозитории отдельно.
6. `verification.md` в `project-specs` собирает статус проверки по каждому сценарию (не по репозиторию).
7. Финализация применяет Delta Specs к Master Specs и архивирует Change — одним вызовом CLI.

## Что не пересекается

`configuration` никогда не имеет собственных Scenario ID — только `AC-*`. Попытка дать `configuration` пакет `implements` или сценарий — ошибка правила 3 (I.16.1).
