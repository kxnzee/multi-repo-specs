# Project context entry point

`openspec/context/` хранит подтверждённые долговечные знания о проекте. Он помогает
понимать Specs и Changes, но не заменяет их. Материалы из `_raw/` не являются
подтверждённым контекстом.

## Правила

- Отделяйте подтверждённые факты от выводов и открытых вопросов.
- Для важного факта указывайте проверяемый источник, если он не очевиден из проекта.
- Неизвестное оставляйте как TODO с полями `question`, `owner`, `expected_source`.
- Используйте фактическую модель владения проекта; фиксированные роли не требуются.
- Если существует `openspec-orch.yaml`, используйте его `repositories` как реестр
  точных `repository-id`; назначение и границы Code Repositories читайте в
  `system-map.yaml` и `repositories/<repository-id>.md`.
- Для инициализации, аудита и обновления используйте команду `/openspec-base-context`.

## Маршрутизация

| Нужно понять | Читать |
|---|---|
| Назначение, пользователи и границы продукта | `01-product-context.md`, `02-domain-glossary.md` |
| Архитектура, компоненты и интеграции | `03-architecture.md`, `system-map.yaml`, `ADR/` |
| Репозитории, их ответственность и границы | `openspec-orch.yaml`, `system-map.yaml`, `repositories/` |
| Доменное поведение и общие инварианты | `04-domain-model.md`, `06-cross-system-invariants.md` |
| Безопасность и ограничения данных | `05-security-and-compliance.md` |
| Проверки и критерии качества | `07-quality-gates.md` |
| Поставка, наблюдение и откат | `08-release-process.md` |

## Open questions

<!-- TODO
question: Какие знания проекта пока не удаётся однозначно направить в тематический файл?
owner: unassigned
expected_source: Project documentation or maintainer confirmation
-->
