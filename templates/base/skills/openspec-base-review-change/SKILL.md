---
name: openspec-base-review-change
description: Провести независимое ревью спеки конкретного OpenSpec Change перед Gate 1, Development или PR Review. Проверять Proposal, Delta Specs, Design и Tasks, полноту списка затронутых репозиториев, согласованность Repository impact, межрепозиторные контракты, трассируемость, тестируемость и evidence поверх штатного openspec validate. Использовать также по запросам «проверь спеку», «готов ли Change к разработке» и «все ли репозитории учтены». По умолчанию работать на чтение, не исправлять артефакты и не записывать решение Gate.
---

# Ревью OpenSpec Change

Проверить не только формальную валидность, но и достаточность Change для принятия
решения человеком.

## Границы

- Встроенный OpenSpec остаётся владельцем schema, артефактов и lifecycle.
- По умолчанию ничего не изменять и не отмечать Tasks выполненными.
- Не записывать Gate, approval или Verification Receipt.
- Не выдавать отсутствие evidence за отсутствие проблемы.
- Не дублировать штатный `/opsx-verify`: review до разработки оценивает качество
  плана, а PR Review — соответствие реализации принятому плану.

## Режимы

- `planning-review` — Proposal, Specs, Design и Tasks перед Gate 1.
- `implementation-readiness` — готовность принятой planning revision и состава
  репозиториев к Development без запуска Apply.
- `pr-alignment` — соответствие выбранной реализации принятому Change.

Если режим не указан, выбрать по запросу и явно назвать его.

## Порядок работы

1. Определить Change и выполнить `openspec status --change "<change-id>" --json` с
   выбранным `--store`.
2. Прочитать все существующие outputs из `artifactPaths`, соответствующие Master
   Specs и относящийся project context.
3. Выполнить строгую неинтерактивную валидацию Change. Отделить ошибки OpenSpec от
   семантических findings.
4. Собрать review set репозиториев и не ограничиваться списком из одного артефакта:
   - `declared` — точные `repository-id`, заявленные в Proposal, Design или Tasks;
   - `inferred` — репозитории, на которые указывают затронутые системы, владельцы
     данных, API, события, зависимости или CodeGraph, но которых нет в Change;
   - `checked-no-change` — релевантные репозитории, для которых обоснован `no-change`.
   Если существует `openspec-orch.yaml`, использовать только его точные role `code`
   ids. Не считать весь registry автоматически затронутым.
5. Проверить трассировку:
   - Jira/источник → Why и scope Proposal;
   - capability Proposal → Delta Spec на том же пути;
   - Requirement → проверяемые Scenarios;
   - Scenario → Design decisions и Tasks, когда они необходимы;
   - для `pr-alignment`: Scenario/Task → код, тест и точный commit.
6. Для каждого репозитория из review set проверить согласованность по цепочке
   `Proposal impact → Design map → Tasks → verification plan/evidence`:
   - роль репозитория и ожидаемое изменение;
   - затрагиваемые компоненты и принадлежащие ему данные;
   - входящие и исходящие контракты;
   - зависимости и порядок реализации;
   - тесты, IFT и ручная проверка;
   - симметричность межрепозиторных контрактов на обеих сторонах.
   Найти неизвестные ids, задачи без `repository-id`, смешанное evidence,
   необоснованный `no-change`, заявленные без работы репозитории и inferred omissions.
7. Проверить новые Scenario ID формата `[SC-<CAPABILITY>-NNN]`, уникальность и
   сохранение существующих ID в `MODIFIED`. Не требовать массового переименования
   исторических Scenarios в рамках текущего Change.
8. Провести четыре reviewer-проекции:
   - Analyst — intent, scope, observable behavior и исключения;
   - Developer — реализуемость, контракты, миграция, rollback и задачи;
   - QA — однозначность Scenarios, негативные и граничные случаи, evidence;
   - Lead — breaking changes, security, данные, несколько доменов и SLO.
9. Если доступен `openspec-base-specification-reviewer`, передать ему Change, режим,
   review set и один независимый read-only вопрос о полноте или согласованности
   спеки. Для архитектурной неопределённости использовать
   `openspec-base-architecture-impact-reviewer`, а для evidence готовой реализации —
   `openspec-base-verification-reviewer`. Отсутствие subagents не блокирует ревью.
10. Удалить дубликаты и отсортировать findings по значимости:
   - `BLOCKER` — без решения нельзя принимать текущий Gate;
   - `WARNING` — риск требует явного решения владельца;
   - `NOTE` — улучшение, не меняющее решение Gate.

## Формат ответа

Вернуть на русском:

- Change, schema, режим и planning revision, если она подтверждена;
- результат штатной валидации;
- findings: `Severity | Область | Finding | Evidence | Требуемое решение`;
- краткую матрицу трассируемости;
- состав review set с категорией `declared | inferred | checked-no-change`;
- матрицу покрытия
  `repository-id → impact → Design → Tasks → verification → статус`;
- межрепозиторные контракты и несовпадения между их сторонами;
- отдельные выводы Analyst, Developer, QA и Lead;
- итог `review_status: ready | ready_with_warnings | blocked`.

`ready` означает отсутствие найденных блокеров в прочитанном scope, а не
автоматический approval или успешную реализацию.
