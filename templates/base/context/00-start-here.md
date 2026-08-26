# Project context entry point

`openspec/context/` хранит подтверждённые долговечные знания о проекте. Он помогает
понимать Specs и Changes, но не заменяет их. Материалы из `_raw/` не являются
подтверждённым контекстом.

## Правила

- Отделяйте подтверждённые факты от выводов и открытых вопросов.
- Для важного факта указывайте проверяемый источник, если он не очевиден из проекта.
- Неизвестное оставляйте как TODO с полями `question`, `owner`, `expected_source`.
- Используйте пять базовых ролей ответственности: Владелец, Аналитик, Разработчик,
  Тестировщик и Лид. Один человек может совмещать несколько ролей; project policy
  назначает конкретных участников и дополнительные approvers.
- Если существует `openspec-orch.yaml`, используйте его `repositories` как реестр
  точных `repository-id`, а связи репозиториев и Specs читайте из валидированной
  модели обязательного OpenSpec Graph Plugin. Отсутствие Plugin declaration или
  Store binding является blocker; локальное техническое устройство читайте только в
  самих Code Repositories и их файлах инструкций агента.
- Не переносите в центральный Store структуру модулей и классов, версии технологий,
  локальные API/config-параметры, команды build/test/lint, CI и упаковку отдельного
  Code Repository.
- Для инициализации, аудита и обновления используйте команду `/openspec-base-context`.
  После Archive либо при периодической сверке ей можно передать точный `--change`,
  повторяемый `--spec <capability-path>` или `--domain <domain-path>`. Пользователь
  задаёт scope, а команда сама выбирает тематические context-файлы и ADR candidates,
  показывает diff и пишет только после отдельного подтверждения.

## Маршрутизация

| Нужно понять | Читать |
|---|---|
| Назначение, пользователи и границы продукта | `01-product-context.md`, `02-domain-glossary.md` |
| Архитектура, компоненты и интеграции | `03-architecture.md`, `ADR/`, `openspec/graph.yaml` через OpenSpec Graph Plugin |
| Репозитории, Specs и их связи | `openspec-orch.yaml`, `openspec/graph.yaml` через OpenSpec Graph Plugin |
| Локальное техническое устройство репозитория | Файл инструкций агента, документация, конфигурация, код и тесты соответствующего Code Repository |
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
