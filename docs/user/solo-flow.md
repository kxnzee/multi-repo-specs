# Поток работы одного человека

Один человек может совмещать роли, но должен явно сохранять решения и evidence.

## 1. Выберите процесс

```bash
openspec new change <change-id> --schema spec-driven-extended
# либо
openspec new change <change-id> --schema superspec-multirepo
```

Дальнейшие команды относятся к `spec-driven-extended`. Superspec следует
собственному DAG, описанному в [Project Template](project-template.md).

## 2. Подготовьте Planning

Если принятый Intent уже содержит изменение, причину, результат, критерии успеха и
ограничения, не создавайте его повторно. Для `spec-driven-extended` выполните:

```text
/spec-driven-extended-intake <change-id>
```

Затем подготовьте Proposal, Delta Specs, Design и Tasks штатным OpenSpec workflow.
Repository Impact должен перечислять только реально изменяемые repositories и их
capabilities.

Если подключён OpenSpec Graph:

```bash
openspec-orch graph inspect --json
```

До Apply подтвердите scope, validation, план проверки и риски.

## 3. Реализуйте Change

Используйте штатный OpenSpec Apply, выполните repository checks и создайте
implementation commits. CodeGraph и Change Tracking опциональны. Если Change Tracking
подключён к текущему Code Repository, его Agent Extension автоматически начинает и
завершает attempt для выбранного канонического task.

При работе без Agent Extension используйте ручной fallback. Для него Change Tracking
должен быть подключён и к Store, и к текущему Code Repository:

```bash
openspec-orch attempt start <change-id> <task-id>
# после commit и стандартной галочки OpenSpec
openspec-orch attempt complete <change-id> <task-id>
```

Plugin не меняет task status и не означает, что тесты прошли.
Возвращённый task выполняется тем же Apply повторно; новая attempt дописывается в
историю и сохраняет предыдущую implementation revision.

## 4. Проведите Feature Acceptance

Agent заполняет Verify evidence фактическими результатами проверок и Scenarios.
Человек явно принимает `PASS` или `FAIL`; без этого решения gate остаётся
`PENDING`. После изменения реализации соберите актуальное evidence и повторите
человеческий gate. Agent и Change Tracking не принимают Feature Acceptance.

## 5. Release и Archive

После review, проверок и явного Release-решения выполните штатный
`/opsx-archive <change-id>`. Если используется Graph, запустите
`openspec-orch graph inspect --json` до и после Archive.
