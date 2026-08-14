# Подключение Store в нестандартных ситуациях

Основной маршрут создания и подключения проекта описан в [шаге 00](../steps/00.md).
Этот справочник нужен, когда Store расположен нестандартно, workspace был перемещён
или локальная регистрация OpenSpec мешает подключению.

## Нестандартное расположение Store

Расположение является нестандартным, если имя каталога Store отличается от `store-id`
или Store находится отдельно от выбранного workspace. Например:

```text
C:/work/rum-multirepo/specifications/       ← имя не равно store-id rum-specs
C:/stores/rum-specs/                        ← Store расположен вне workspace
C:/work/rum-multirepo/openspec/rum-specs/   ← дополнительная вложенность
```

Передайте workspace один раз:

```bash
openspec-orch connect --workspace <workspace>
```

Команда сохранит абсолютный путь только в локальной Git-конфигурации Store. Он не
попадёт в commit. Последующие `openspec-orch connect` и `openspec-orch explore` можно выполнять без
`--workspace`.

OpenSpec Orchestrator определяет workspace в следующем порядке:

1. явный `--workspace`;
2. путь, сохранённый предыдущим `openspec-orch connect --workspace`;
3. родитель Store, если имя каталога Store совпадает со `store-id`;
4. остановка с инструкцией, если workspace определить нельзя.

Если workspace перемещён, повторите `openspec-orch connect --workspace <workspace>` с новым
путём.

## Store уже зарегистрирован локально

Проверьте существующие регистрации:

```bash
openspec store list
```

Если локальную регистрацию нужно сбросить, выполните:

```bash
openspec store unregister <store-id>
```

Команда удаляет только локальную регистрацию и не удаляет файлы Store. Для уже
инициализированного Store после этого выполните `openspec-orch connect`, а не повторный
`openspec-orch init`.

Для полностью нового Store используйте новый пустой каталог. Не удаляйте отдельно
`.openspec-store`: это оставит частично инициализированное состояние.

После устранения причины вернитесь к [шагу 00](../steps/00.md) и повторите
`openspec-orch connect`.
