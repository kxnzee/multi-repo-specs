# Работа с subagents при планировании Change

Repository Context Pass помогает основному агенту собрать технический контекст из Code Repositories при подготовке Specs, Design и Tasks на шаге 03. Здесь описано, когда запускаются subagents, какие данные они получают и как добавить новую специализацию.

`openspec-orch init` устанавливает project-level native subagents в provider-specific каталог `agents/`. Обязательным является только базовый профиль; frontend и backend входят в начальный набор как optional специализации:

| Subagent type | Назначение |
|---|---|
| `repository-context-pass` | Обязательный универсальный fallback, когда специализация не найдена или не подтверждена |
| `frontend-context-pass` | Optional: пользовательские состояния, UI-границы, API-клиенты, rollout и frontend-проверки |
| `backend-context-pass` | Optional: владение данными, API и события, совместимость, миграции и backend-проверки |

Для Qwen определения устанавливаются в `.qwen/agents/`, для GigaCode — в `.gigacode/agents/`. Доступные профили можно проверить штатной командой `/agents`.

## Как запускается Repository Context Pass

Отдельной пользовательской команды нет:

```text
/opsx-continue <change-id>
        ↓
openspec/config.yaml определяет необходимость технического исследования
        ↓
основной planning-agent подбирает native subagent по description
        ↓
subagent исследует один repository-id и один вопрос
        ↓
основной агент проверяет и синтезирует результат
        ↓
создаётся стандартный OpenSpec-артефакт
```

Harness устанавливает определения, но не запускает subagents самостоятельно и не хранит их ответы между сессиями.

## Как выбирается профиль

- Runtime обнаруживает project-level определения из provider-specific каталога `agents/`.
- Основной агент подбирает специализацию по полю `description`, подтверждённой ответственности репозитория и текущему вопросу.
- `repository-context-pass` используется по умолчанию и при любой неоднозначности.
- Имя `repository-id` само по себе не доказывает специализацию.
- `openspec/config.yaml` не содержит перечень optional subagents, поэтому их добавление или удаление не меняет общий routing.

Один профиль можно запускать несколькими независимыми экземплярами для разных репозиториев. Несколько независимых passes допускается выполнять параллельно, но основной агент не создаёт артефакт до получения и проверки всех необходимых результатов.

## Что получает subagent

Обычный именованный subagent начинает без planning-истории. Основной агент передаёт ему автономное ограниченное задание:

- `change_id` и целевой `artifact`;
- один `repository_id`;
- абсолютные `checkout` и `repository_instructions_path`;
- точную 40-символьную Git revision;
- один конкретный `question`;
- минимальные `business_boundaries` и `system_context`.

До запуска и после результата основной агент проверяет repository identity, чистоту checkout и revision. Сами профили получают только read-only файловые инструменты без shell и средств записи.

## Что возвращает subagent

Базовый и все optional профили возвращают единый контракт:

```yaml
repository_id: payments-backend
revision: 0123456789abcdef0123456789abcdef01234567
question: Как репозиторий участвует в поставке нового статуса?
status: complete # complete | needs_followup | blocked
facts: []
system_impact:
  responsibilities: []
  integrations: []
  compatibility: []
  rollout: []
  rollback: []
verification_implications: []
confidence: high # high | medium | low
open_questions: []
evidence:
  - reference: path/to/file:line
    supports: Краткое указание подтверждаемого факта
repository_instructions_update_candidate: false
```

Основной агент проверяет `repository_id`, revision и исходный вопрос, разрешает противоречия и переносит в центральные артефакты только бизнесовый и межсистемный результат. Файлы, классы, функции и локальные шаги реализации остаются transient evidence.

## Ограничения

- Subagent не создаёт Change и не изменяет Store или Code Repository.
- `repository_instructions_path` вычисляется как `<checkout>/<agent.instructions_file>` из проверенного `openspec-orch.yaml`.
- Основной агент проверяет, что путь не выходит из `checkout`; существующий файл не должен разрешаться за его пределы или быть symlink в последнем сегменте.
- Subagent сначала читает только этот файл инструкций, затем адресно код и тесты.
- Отсутствие или неполнота файла инструкций не блокирует pass.
- Каталоги `commands/`, `skills/` и `agents/` не сканируются в поиске другого файла инструкций.
- Если runtime не поддерживает native subagents, основной агент может выполнить один ограниченный pass в своём контексте, но не называет его изолированным.

## Как добавить новую специализацию

Новая специализация нужна только тогда, когда отличается предметный фокус или набор инструментов. Не создавайте профиль только для конкретного имени репозитория.

Например, для security-исследования добавьте в provider-specific каталог файл `agents/security-context-pass.md`:

```md
---
name: security-context-pass
description: Использовать ПРОАКТИВНО для read-only исследования security и compliance границ Code Repository
model: inherit
tools:
  - read_file
  - read_many_files
  - grep_search
  - glob
  - list_directory
---

Ты выполняешь security-специализацию Repository Context Pass.

Работай с одним repository-id и одним вопросом. Не изменяй файлы.
Сначала прочитай правила безопасности и compliance в `repository_instructions_path`,
затем адресно проверь относящиеся к вопросу код и тесты.

Сохрани общий контракт результата: repository_id, revision, question, status,
facts, system_impact, verification_implications, confidence, open_questions,
evidence и repository_instructions_update_candidate.
```

После добавления:

1. убедитесь, что `name` уникален;
2. опишите в `description`, когда основной агент должен выбрать профиль;
3. не выдавайте инструменты записи без отдельной необходимости;
4. сохраните общий контракт результата Repository Context Pass;
5. проверьте обнаружение и понятность `description` через `/agents`;
6. не добавляйте optional профиль в обязательные проверки `openspec-orch init` и `openspec-orch connect`.

Для включения профиля в начальный набор новых Store добавьте его шаблон в `harness/init/subagents/`. Harness установит файл в каталог `agents/` выбранного adapter. Расширять `openspec/config.yaml` и список обязательных профилей при этом не нужно.
