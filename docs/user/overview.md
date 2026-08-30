# Обзор продукта

OpenSpec Orchestrator — локальный CLI для центрального OpenSpec Store и нескольких
репозиториев реализации. Он помогает создать одинаковый проектный каркас, подключить
рабочие копии и расширить процесс через Plugins, не перенося требования в Core или
Code Repositories.

## Модель проекта

```text
workspace/
├── specs/                         Store Repository
│   ├── openspec/                  Specs, Changes, schema и project context
│   ├── openspec-orch.yaml         реестр проекта и Plugin bindings
│   ├── tracking/cycles/           командное состояние Change Tracking
│   └── .openspec-orch/            локальное состояние и runtime cache
└── src/
    ├── frontend/                  Code Repository
    └── backend/                   Code Repository
```

Store — единственное место, которому принадлежат OpenSpec Changes и Master Specs.
Code Repositories реализуют принятый Change и не создают собственные
`openspec/changes`.

## Слои ответственности

| Слой | Отвечает за | Не отвечает за |
|---|---|---|
| OpenSpec | Change artifacts, Requirements, Scenarios, Apply, Sync и Archive | Multi-repository workspace и Plugin lifecycle |
| Orchestrator Core | `init`, `connect`, repository status, безопасные facades, Plugin lifecycle | Содержание требований, реализацию и Release |
| Project Template | Context, custom schema/config и дополнительные assets | Agent workflow и выбор компонентов |
| Extension | Instructions, skills, commands, subagents, hooks и простые MCP | Repository lifecycle и собственный runtime |
| Plugin | Свои команды, repository lifecycle, данные и Extension contribution | Изменение Core и чужих Plugin contracts |
| Команда | Intent, Gates, код, review, проверки, rollout, Release и разрешения | Автоматическое делегирование решений инструменту |

## Основные термины

- **Intent** — принятое объяснение изменения, Why Now, ожидаемого улучшения,
  критериев успеха и ограничений.
- **Intake** — первый artifact schema `base-v1`; уточняет входные данные и выбирает
  маршрут `ready_for_proposal`, `explore_recommended` или `blocked`.
- **Change** — один согласуемый набор Proposal, Delta Specs, Design и Tasks.
- **Master Spec** — нормативное описание уже действующего поведения после Archive.
- **Repository Impact** — только Code Repositories, где Change требует изменения
  кода, тестов, конфигурации или документации.
- **Gate** — явное решение людей. Ни агент, ни Graph, ни Change Tracking не принимают
  Gate автоматически.
- **Cycle** — опциональная Change Tracking привязка Change к planning revision и
  составу Code Repositories.
- **Snapshot** — детерминированный набор точных implementation commits текущего
  Cycle; сам по себе не означает, что тестирование прошло.

## Жизненный цикл Change

```text
Intent
  → Intake
  → Explore при необходимости
  → Proposal → Delta Specs → Design → Tasks
  → Graph inspection и проверка scope
  → Gate 1
  → опциональный сбор implementation evidence через Change Tracking
  → Apply
  → PR / checks / merge / deployment
  → проверка текущей версии
  → Gate 2 → Gate 3 → Release
  → Archive → Graph handoff
```

OpenSpec Graph подключается отдельно как Plugin: Template и Extensions не
устанавливают его автоматически и не определяют выбор Plugins. Полный описанный
`openspec-base` flow использует Graph после появления Delta Specs и перед Apply,
поэтому пользователь явно выбирает и связывает Plugin для этого маршрута.

## Поддерживаемые агенты

Distribution-owned Agent catalog принимает `--agent qwen`, `--agent gigacode` и
`--agent claude` независимо от Template. GigaCode использует Qwen-compatible CLI и
OpenSpec adapter, но собственный `gigacode-extension.json`.

## Важные ограничения

- Core не обновляет существующие checkout командой `connect` и сам не задаёт
  Plugin-specific Git lifecycle. Change Tracking выполняет pull/commit/push только для
  собственного `tracking/cycles/`; остальные Git mutation остаются вне Core.
- Change Tracking хранит Cycle, repository-owned receipts и verification в общем Git
  Store; Snapshot детерминированно вычисляется из receipts и не образует вторую базу.
- последний `done` собирает точную версию, а `verify pass|fail` фиксирует внешнее
  решение; Plugin не делает checkout и не запускает тесты.
- OpenSpec Graph компилирует модель Store из OpenSpec-артефактов; CodeGraph индексирует
  файлы и symbols одного явно связанного Store или Code Repository. Это разные модели.
- Jira, Zephyr, Confluence, CI и deployment не интегрированы в текущем репозитории.
