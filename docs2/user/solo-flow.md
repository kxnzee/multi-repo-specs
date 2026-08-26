# Поток работы одного человека

Один человек может выполнять все допустимые роли, но решения и evidence не должны
исчезать. В течение процесса он последовательно меняет «шляпу»: Владелец принимает
scope, Аналитик формирует Planning, Разработчик реализует, Тестировщик проверяет,
Лид оценивает риск-триггеры.

## Перед началом

Из Store проверьте workspace и Graph:

```bash
openspec-orch repository status
openspec-orch graph status --json
```

Если Graph еще не связан, выполните однократное подключение из
[начала работы](getting-started.md). Не устанавливайте Change Tracking только потому,
что он существует: Standard flow полностью поддерживается.

## Шаг 1. Принять Intent

Intent должен содержать:

- что меняется и для кого;
- Why Now;
- наблюдаемое улучшение;
- критерии успеха;
- ограничения и явно исключенный scope.

Если это уже есть в принятой Jira Story, Daily Intent Brief или другом доступном
источнике, повторно запускать `base-intent` не нужно. Одной ссылки или номера без
доступного содержания недостаточно.

## Шаг 2. Создать Intake

В агенте из Store:

```text
/openspec-base-intake <change-id>
```

Команда задает по одному недостающему вопросу и записывает `intake.md` только после
появления содержательного Planning Route:

- `ready_for_proposal` — переходите к Proposal;
- `explore_recommended` — выполните ограниченный `/opsx-explore`, затем повторите
  Intake, чтобы findings попали в тот же artifact;
- `blocked` — получите решение Владельца или нормативный источник.

Пустой заранее созданный `intake.md` не является завершенным Intake.

## Шаг 3. Завершить Planning

Штатным OpenSpec workflow подготовьте:

1. `proposal.md` — проблема, пользователи, Why Now, результат, scope и Repository
   Impact;
2. Delta Specs — наблюдаемое поведение и Scenarios;
3. `design.md` — системные границы, публичные контракты, риски, миграция, rollout и
   rollback;
4. `tasks.md` — repository sections и финальный checkpoint проверки текущей версии.

Repository Impact содержит только зарегистрированные Code Repositories, где реально
меняются код, тесты, конфигурация или документация. Не добавляйте весь registry,
review-only репозитории и строки `no-change`.

## Шаг 4. Проверить Graph scope

После валидных Delta Specs:

```bash
openspec-orch graph build
openspec-orch graph status --json
openspec-orch graph impact <change-id>
openspec-orch graph check-scope <change-id> --repo <repository-id>...
```

Остановитесь при `missing_required_repositories`, `missing_delta_specs` или
`unmapped_master_specs`. Review/dependent repositories — кандидаты на адресную
проверку, а не автоматическое расширение scope. Для каждой непосредственно
изменяемой Master Spec подтвердите постоянную связь `implemented_by`; временный
`targets` ее не заменяет.

## Шаг 5. Принять Gate 1

Даже если все роли выполняете вы, явно зафиксируйте:

- Intent, Intake и Planning согласованы;
- strict OpenSpec validation проходит;
- Repository Impact, Design и Tasks содержат одинаковый scope;
- новые/измененные Scenarios имеют план проверки;
- риск-триггеры лида рассмотрены;
- финальный verification checkpoint в Tasks назначен и пока открыт.

После Gate 1 закоммитьте Planning обычным Git-процессом. Orchestrator этого не делает.

## Шаг 6A. Standard Apply

Выберите этот режим, если Change Tracking не подключен или при `CYCLE_NOT_FOUND` вы
явно решили продолжить без Cycle.

1. Передайте Change штатному OpenSpec Apply через установленный
   `openspec-base-apply-context`.
2. Реализуйте только принятые Tasks в затронутых Code Repositories.
3. Для адресной навигации можно использовать CodeGraph; отсутствие индекса не
   блокирует Apply.
4. Запустите repository-local lint/tests/build и создайте implementation commits.
5. Зафиксируйте точный набор commits и verification evidence своим обычным способом.

Standard Apply не создает Cycle, Results, Snapshot или Verification Receipt.

## Шаг 6B. Apply с Change Tracking

Используйте режим, когда нужен воспроизводимый локальный набор версий.

```bash
openspec-orch assign <change-id> --repo frontend --repo backend
```

Проверьте preview и подтвердите запись. Затем вручную закоммитьте Cycle Record в
Store. Пока он не закоммичен, `record assignment` и `verify` заблокированы.

После реализации каждого Repository:

```bash
openspec-orch record assignment <change-id> \
  --repo frontend \
  --commit <full-40-char-sha1> \
  --status completed \
  --source human
```

Для незавершенного результата используйте `failed` или `blocked`, а не ложный
`completed`. Когда все Results завершены:

```bash
openspec-orch verify <change-id>
```

`verify` печатает Snapshot и точные SHA, но ничего не тестирует. Выполните checkout
или deployment именно этих версий, проведите внешнюю проверку и запишите результат:

```bash
openspec-orch record verification <change-id> \
  --result pass \
  --source human
```

## Шаг 7. Проверка, Gates и Release

На текущем implementation candidate:

1. выполните PR/review и обязательные repository checks;
2. зафиксируйте поставляемый artifact и точные commits;
3. выполните IFT/QA и принятые Scenarios;
4. устраните блокирующие дефекты и повторите проверку;
5. явно закройте финальный checkpoint `tasks.md`;
6. примите Gate 2, Gate 3 и решение о Release.

Новый commit или deployment после проверки делает evidence нетекущим. Повторите
проверку и не оставляйте checkbox закрытым для старой версии.

## Шаг 8. Archive

Перед Archive повторите Graph preflight и scope check. Затем после явного решения:

```text
/opsx-archive <change-id>
```

После штатного Archive:

```bash
openspec-orch graph build
openspec-orch graph status --json
openspec-orch graph impact <change-id>
```

Проверьте напрямую измененные Master Specs и их `implemented_by`. Ошибка post-Archive
Graph handoff не отменяет уже выполненный Archive, но handoff остается незавершенным.

Необязательно проведите read-only audit долговечного context/ADR:

```text
/openspec-base-context audit --change <change-id>
```

Запись изменений context выполняется отдельным `update` только после показа diff и
вашего подтверждения.
