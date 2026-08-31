# Поток работы одного человека

Один человек может совмещать роли, но должен явно сохранять решения и evidence.

## 1. Выберите процесс

```bash
openspec new change <change-id> --schema spec-driven-extended
# либо
openspec new change <change-id> --schema superspec-multirepo
```

Дальнейшие Base-команды относятся к `spec-driven-extended`. Superspec следует
собственному DAG, описанному в [Project Template](project-template.md).

## 2. Подготовьте Planning

Если принятый Intent уже содержит изменение, причину, результат, критерии успеха и
ограничения, не создавайте его повторно. Для Base выполните:

```text
/openspec-base-intake <change-id>
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
implementation commits. CodeGraph и Change Tracking опциональны.

Если нужен общий журнал revisions:

```bash
openspec-orch track <change-id>
# из каждого затронутого Code Repository
openspec-orch done
```

`track` не назначает Tasks, а `done` не означает, что тесты прошли.

## 4. Проверьте точный candidate

Зафиксируйте commits и поставляемый artifact, выполните принятые Scenarios в целевом
окружении и заполните Verify artifact. При Change Tracking после внешней проверки:

```bash
openspec-orch verify pass
# либо
openspec-orch verify fail --note "регрессия"
```

Новый commit или deployment требует повторной проверки. Agent не закрывает
человеческий verification checkpoint самостоятельно.

## 5. Release и Archive

После review, проверок и явного Release-решения выполните штатный
`/opsx-archive <change-id>`. Если используется Graph, запустите
`graph inspect --json` до и после Archive.
