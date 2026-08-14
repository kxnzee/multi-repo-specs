# Context entry point

Этот файл задаёт порядок чтения подтверждённого контекста. `_raw/` не является источником нормативных фактов.

## Правила подтверждения

- Агент отделяет факты из кода, контрактов и принятых ADR от предположений.
- Изменение нормативного файла принимает его владелец из CODEOWNERS.
- Неизвестное остаётся в inline TODO с вопросом, владельцем и ожидаемым источником.

## Маршрутизация артефактов

| Артефакт | Обязательный контекст |
|---|---|
| Explore, Proposal, Delta Specs | `01-product-context.md`, `02-domain-glossary.md`, `03-architecture.md`, `04-domain-model.md`, `05-security-and-compliance.md`, `06-cross-system-invariants.md`, `system-map.yaml`, релевантные ADR и подходящие Master Specs |
| System Impact, Design | `03-architecture.md`, `05-security-and-compliance.md`, `06-cross-system-invariants.md`, `system-map.yaml`, релевантные ADR |
| Tasks, Verification | `07-quality-gates.md`, принятые артефакты Change |
| Delivery | `05-security-and-compliance.md`, `08-release-process.md`, принятый Design |

## Open questions

<!-- TODO
question: Какие ещё сведения требуется маршрутизировать в конкретный context-файл?
owner: Spec Owner
expected_source: Первичный /sdd-context и подтверждения владельцев
-->
