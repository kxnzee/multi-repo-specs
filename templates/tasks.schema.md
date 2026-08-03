# Схема артефакта `tasks.md`

**Назначение:** Work Packages изменения (I.16.1), в формате, который читают и человек, и `sdd check --change` / `sdd load` (`harness/`).
**Правило:** это единственный источник Work Packages. Таблица в `templates/planning-pr-template.md` — читаемое резюме для ревью, не источник данных; при расхождении верен `tasks.md`.

## Формат

Один блок ` ```yaml ` с ключом `work_packages` — список объектов:

```markdown
# Tasks: <change-id>

​```yaml
work_packages:
  - id: UI-01
    repository: ui
    type: implements
    scenario_ids: [PILOT-003.1, PILOT-003.2]
  - id: CONFIG-01
    repository: configuration
    type: enables
    ac_ids: [AC-PILOT-003.1]
​```
```

## Поля

| Поле | Обязательно | Для каких `type` |
|---|---|---|
| `id` | да | оба — это то же значение, что попадёт в `.sdd/change.yaml` → `work_packages` в кодовом репозитории |
| `repository` | да | оба |
| `type` | да, `implements` или `enables` | оба |
| `scenario_ids` | да для `implements`, запрещено для `enables` | — |
| `ac_ids` | да для `enables`, не используется для `implements` | — |

## Правило 3 (I.16.1), что проверяет `sdd check --change`

- `implements` без `scenario_ids` — блокирует.
- `enables` со непустым `scenario_ids` — блокирует («enables от требований не зависит по определению»).
- `enables` без `ac_ids` — блокирует.
- Пакет без `id`, `repository` или `type` — блокирует (нечего будет записать в карточку изменения).

## Почему не заголовки `### <repo> — тип`

Первая версия парсера ориентировалась на markdown-заголовки с длинным тире — формат не был нигде задокументирован и не совпадал с таблицей в `templates/planning-pr-template.md`. Единый YAML-блок с явным `id` решает обе проблемы: одна схема для человека и для `sdd`, и есть отдельный идентификатор пакета (нужен `.sdd/change.yaml`), а не только имя репозитория.
