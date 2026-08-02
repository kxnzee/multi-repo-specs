# sdd — утилиты обвязки

Реализует часть Слоя E из `harness/SPEC.md` (копия Части III регламента), в объёме, нужном пилоту Pilot Core:

| Команда | Статус | Покрывает |
|---|---|---|
| `sdd setup` | реализовано | III.12 «sdd setup» |
| `sdd fetch-repos --change <id>` | реализовано | III.12 + раздел 7 профиля Pilot Core (восемь гарантий) |
| `sdd load <change-id> --repo <name>` | реализовано | III.12 «sdd load» |
| `sdd check change <id>` | реализовано | правило 1 (раздел 4 профиля Pilot Core) |
| `sdd check code --path <repo>` | реализовано | правила 4 и 5 (раздел 4 профиля Pilot Core) |
| `sdd conflicts`, `preview`, `status`, `baseline`, `cancel`, `finalize`, `smoke`, `metrics` | не реализовано | по III.17 — не раньше первой недели пилота / появления второго изменения |

## Установка

```bash
cd harness
npm install
```

Локально можно вызывать через `node harness/bin/sdd.js <команда>` или добавить `harness/node_modules/.bin` в `PATH` после `npm link`.

## Пре-коммит-хук

```bash
harness/scripts/install-hooks.sh
```

Копирует `harness/hooks/pre-commit` в `.git/hooks/pre-commit` (последний не версионируется git). Хук запускает `sdd check change <id>` для каждого изменения, чьи файлы попали в коммит.

## `harness/repos.yaml`

Адреса read-only remote для `sdd fetch-repos`. `configuration` туда не входит — раздел 7 профиля Pilot Core.

## Тесты

```bash
npm test
```

Обязательно включают негативные случаи (III.12, требование к `sdd smoke`, распространено и на `check`): невалидная фикстура `pilot-004` проверяет, что каждое из правил 1 и 3 действительно ловит нарушение, а не молча проходит.

## Что не сделано осознанно

- **Реестр хранилищ** (`~/.sdd/registry.json`) — машинное состояние, не в git, как того требует III.12.
- **`sdd fetch-repos`** не может реально клонировать `ui`/`backend` в этой сессии — адресов read-only remote (В-04) в `harness/repos.yaml` нет. Команда работает и явно отказывает с понятным сообщением (fail closed, III.16), а не притворяется, что прочитала.
- **Правила 2 и 3** (регистрация репозиториев, Work Packages) автоматизированы только частично: структура Work Package в `tasks.md` проверяется (`sdd check change`), а регистрация владельцев — по чек-листу `templates/planning-pr-template.md`, вручную, как и предписано профилем на первой неделе пилота.
