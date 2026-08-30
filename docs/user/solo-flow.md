# Поток работы одного человека

Один человек может выполнять все допустимые роли, но решения и evidence не должны
исчезать. В течение процесса он последовательно меняет «шляпу»: Владелец принимает
scope, Аналитик формирует Planning, Разработчик реализует, Тестировщик проверяет,
Лид оценивает риск-триггеры.

## Перед началом

Из Store проверьте workspace и Graph:

```bash
openspec-orch repository status
openspec-orch graph inspect --json
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
review-only репозитории и строки `no-change`. Заполняйте строгую таблицу
`Repository | Capabilities`, сопоставляя каждый repository-id с точными capability
paths текущего Change.

## Шаг 4. Проверить Graph

После валидных Delta Specs:

```bash
openspec-orch graph inspect --json
```

Остановитесь при любой error. Проверьте warnings и убедитесь, что Repository Impact,
Design и Tasks описывают один scope. Graph автоматически выводит нейтральные
Repository–Master Spec связи; `UNLINKED_MASTER_SPEC` не расширяет scope.

## Шаг 5. Принять Gate 1

Даже если все роли выполняете вы, явно зафиксируйте:

- Intent, Intake и Planning согласованы;
- strict OpenSpec validation проходит;
- Repository Impact, Design и Tasks содержат одинаковый scope;
- новые/измененные Scenarios имеют план проверки;
- риск-триггеры лида рассмотрены;
- финальный verification checkpoint в Tasks назначен и пока открыт.

После Gate 1 закоммитьте Planning обычным Git-процессом. Orchestrator этого не делает.

## Шаг 6. Apply и опциональный сбор evidence

1. Передайте Change штатному OpenSpec Apply через установленный
   `openspec-base-apply-context`.
2. Реализуйте только принятые Tasks в затронутых Code Repositories.
3. Для адресной навигации можно использовать CodeGraph; отсутствие индекса не
   блокирует Apply.
4. Запустите repository-local lint/tests/build и создайте implementation commits.
5. Зафиксируйте точный набор commits и verification evidence своим обычным способом.

Change Tracking не меняет этот Apply. Если нужен воспроизводимый командный набор
версий, после Planning отдельно начните сбор implementation evidence:

```bash
openspec-orch track <change-id>
```

Команда фиксирует evidence scope: берёт `frontend` и `backend` из принятого
`Repository Impact`, создаёт tracking-коммит и публикует его в Store. Она не назначает
Tasks и не означает начало работы над ними. Ручное копирование SHA или отдельный
commit служебного файла не нужны.

После реализации вызовите из корня каждого затронутого Code Repository с чистым
рабочим деревом:

```bash
openspec-orch done
```

Команда сама определит Repository и `HEAD`. При нескольких активных Changes используйте
`done --change <change-id>`. Незавершённые Tasks, блокировки и неуспешную реализацию
фиксируйте в OpenSpec, а не в Plugin. `done` только передаёт конкретный SHA; последняя
переданная revision автоматически собирает точную версию.

Разверните или checkout-ните именно показанную версию и проведите внешнюю проверку.
Затем зафиксируйте человеческое или CI-решение:

```bash
openspec-orch verify pass
# либо
openspec-orch verify fail --note "регрессия"
```

`verify pass|fail` не запускает тесты. Если после проверки выполнить новый `done`,
собранная версия изменится, а прежняя проверка будет показана как устаревшая.
Все четыре основные команды синхронизируют tracking-файлы через Store. Для локального
эксперимента без публикации добавьте `--no-push` к `track`, `done` или `verify`.

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

Перед Archive повторите `graph inspect --json`. Затем после явного решения:

```text
/opsx-archive <change-id>
```

После штатного Archive:

```bash
openspec-orch graph inspect --json
```

Проверьте, что архивный Change сохранил Repository–Master Spec связи. Ошибка
post-Archive inspect не отменяет уже выполненный Archive, но handoff остается
незавершенным.

Необязательно проведите read-only audit долговечного context/ADR:

```text
/openspec-base-context audit --change <change-id>
```

Запись изменений context выполняется отдельным `update` только после показа diff и
вашего подтверждения.
