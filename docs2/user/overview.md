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
│   └── .openspec-orch/            tracked Cycle Records и локальное состояние
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
| Project Template | Schema, context, команды/skills агента, правила Planning и required Plugins | Runtime конкретного Plugin |
| Plugin | Свои команды, repository lifecycle, данные, MCP/agent integration и Template | Изменение Core и чужих Plugin contracts |
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
  → Graph impact/scope
  → Gate 1
  → Standard Apply или Cycle + Apply
  → PR / checks / merge / deployment
  → проверка текущей версии
  → Gate 2 → Gate 3 → Release
  → Archive → Graph handoff
```

Base Template требует OpenSpec Graph, поэтому Graph входит в штатный flow этой
документации. Custom Template без этой зависимости должен определить собственную
политику и не обязан повторять Graph-шаги.

## Поддерживаемые агенты

Base Template принимает `--agent qwen`, `--agent gigacode` и `--agent claude`.
Mapping определяет provider-specific каталоги, корневой файл инструкций, commands,
skills и subagents. Эти же три Agent поддерживаются Plugin Templates и CodeGraph
integration.

## Важные ограничения

- Core не обновляет существующие checkout командой `connect` и не выполняет Git
  mutation кроме clone отсутствующего Code Repository в strict mode.
- Change Tracking v1 хранит Receipts и Snapshots локально; между машинами через Git
  переносится только Cycle Record.
- `verify` вычисляет Snapshot, но не делает checkout и не запускает тесты.
- OpenSpec Graph индексирует Store topology; CodeGraph индексирует файлы и symbols
  одного Code Repository. Это разные модели.
- Jira, Zephyr, Confluence, CI и deployment не интегрированы в текущем репозитории.
