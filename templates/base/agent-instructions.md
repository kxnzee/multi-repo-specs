# Инструкции для агента

## Контекст центрального Store

- Текущий репозиторий — центральный OpenSpec Store. Каталог `openspec/` является
  источником истины для Specs и Changes; прикладной код находится в
  зарегистрированных Code Repositories.
- `openspec/context/` хранит подтверждённый долговечный контекст проекта, но не
  заменяет Requirements и Delta Specs. Для его инициализации и актуализации вызывай
  команду `/openspec-base-context`.
- Для списка проверяемых тест-кейсов по конкретному Change используй project skill
  `openspec-base-test-cases`.
- Для анализа затронутых систем, capability, контрактов и проверок используй project
  skill `openspec-base-analyze-impact`.
- Для независимой проверки Proposal, Delta Specs, Design и Tasks перед Gate или PR
  Review используй project skill `openspec-base-review-change`.
- `openspec-orch.yaml` описывает конфигурацию Core и реестр репозиториев,
  `.openspec-store/` — metadata Store.
- Перед созданием или проверкой Change прочитай из `openspec-orch.yaml` точные
  `repository-id` с role `code`, затем сопоставь их с
  `openspec/context/system-map.yaml` и файлами
  `openspec/context/repositories/<repository-id>.md`. В Proposal, Design и Tasks
  разделяй влияние и evidence по этим id; Requirements и Scenarios оставляй
  capability-oriented и не дублируй по репозиториям.
- Если в исследуемом Code Repository есть актуальный `.codegraph/` и доступен MCP
  server `codegraph`, сначала используй CodeGraph для навигации и только затем
  адресное чтение недостающих источников. Его отсутствие не блокирует работу.

## Постоянные ограничения

- Создавай, изменяй и архивируй OpenSpec Changes только в центральном Store. Code Repositories реализуют существующие Changes и не создают собственные каталоги `openspec/changes/`.
- Не изменяй штатные OpenSpec `openspec-*` skills и `opsx-*` commands, созданные
  `openspec init`. Артефакты `openspec-base-*` принадлежат базовому Project Template.
- Встроенный OpenSpec skill всегда остаётся владельцем workflow и артефактов. Нативные
  project subagents используй только для ограниченного read-only исследования; они не
  создают и не изменяют OpenSpec-артефакты или код.
- Имена сабагентов базового Template, обслуживающих OpenSpec workflow, начинаются с
  `openspec-base-`.
  Профили без этого префикса являются общими project subagents и не получают
  OpenSpec-роль автоматически.
- Не считай вывод project skill решением Gate: approval принимает человек в
  установленном процессом месте.
- Не архивируй Change, пока не завершена реализация во всех затронутых Code
  Repositories и не выполнена ручная проверка.
