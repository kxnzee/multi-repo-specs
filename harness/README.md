# sdd — утилиты обвязки

Реализует часть Слоя E из `harness/SPEC.md` (копия Части III регламента). **Эта поставка — только обвязка, нужная команде `/sdd-context`.** `sdd setup`, `sdd fetch-repos`, `sdd load`, `sdd check --change`, `sdd check --code` — отдельная задача, идёт своим PR; после её слияния этот `harness/` дополнится, не переписывается с нуля.

| Команда | Статус | Покрывает |
|---|---|---|
| `sdd check --context` | реализовано | III.12 «--context» — минимальный состав и объём файлов `openspec/context/*.{md,yaml}` верхнего уровня (без `_raw/` и каталогов подробностей); только предупреждения, ничего не блокирует |
| `sdd check --ids [--planning-ref <REF>...] [--prefix <ПРЕФИКС>]` | реализовано | III.12 «--ids» — сквозная уникальность Scenario ID по Master Specs, активным изменениям и явно переданным открытым planning refs (блокирует дубликаты); с `--prefix` — занятость префикса (предупреждение) |
| `sdd setup`, `fetch-repos`, `load`, `check --change`, `check --code` | не реализовано в этой поставке | отдельная задача (см. `harness/registry.yaml`) |
| `sdd conflicts`, `preview`, `status`, `baseline`, `cancel`, `finalize`, `smoke`, `metrics` | не реализовано | по III.17 — не раньше первой недели пилота / появления второго изменения |

Область `sdd check` задаётся флагом, не подкомандой — дословно по III.12: «область задаётся явно, а не угадывается по каталогу».

## Установка

```bash
npm --prefix harness install
```

Требует Node `>=20.19` (как и сам OpenSpec CLI). Локально: `node harness/bin/sdd.js check --context` / `--ids`.

Для полной проверки I.7.4 сначала получите refs открытых planning PR, затем передайте каждый ref отдельно:

```bash
node harness/bin/sdd.js check --ids \
  --planning-ref refs/remotes/origin/planning-one \
  --planning-ref refs/remotes/origin/planning-two
```

Без `--planning-ref` проверяются только Master Specs и активные изменения текущего checkout, а команда печатает предупреждение о неполном охвате. Недоступный ref блокирует проверку.

Команда `/sdd-context` является project-local командой Qwen. В `project-specs` она уже лежит в `.qwen/commands/`. Для Процедуры B установите ту же версию в каждый кодовый репозиторий:

```bash
harness/scripts/install-sdd-context.sh /path/to/ui
harness/scripts/install-sdd-context.sh /path/to/backend
harness/scripts/install-sdd-context.sh /path/to/configuration
```

Скрипт не перезаписывает отличающийся файл молча.

## Тесты

```bash
npm --prefix harness test
```

13 тестов: `checkContext` (минимальный состав, объём, игнорирование `_raw/`), `checkIds` (сквозные дубликаты блокируют, MODIFIED не даёт ложного дубля, registry учитывается, planning refs сканируются, `--prefix` только предупреждает, архив не пересканируется).

## Почему такой узкий объём

`/sdd-context` (III.11, «Сборщики контекста», редакция 3.5.4) вызывает только `sdd check --context` и `sdd check --ids` — команда явно не повторяет проверку размера и сравнение префиксов сама (III.11: «Проверки вызываются, а не повторяются»). Остальные команды `sdd` этой команде не нужны, поэтому не тянутся в эту поставку — меньше кода, меньше поверхность для конфликта со второй задачей (`sdd setup`/`fetch-repos`/`load`/`check --change`/`--code`), которая идёт отдельным PR.

## Что не сделано осознанно

- `harness/registry.yaml` перечисляет операции, которых здесь нет (`setup`, `fetch-repos`, `load`, `check --change`, `check --code`) со статусом «не реализовано в этой поставке» — не забыты, а сознательно за пределами этой задачи.
- Провайдер Git hosting не угадывается: полный набор открытых planning refs передаёт CI или человек через повторяемый `--planning-ref`. Без него команда явно предупреждает о неполном охвате.
