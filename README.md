# OpenSpec Orchestrator

OpenSpec Orchestrator помогает ИИ-агентам работать с требованиями и кодом в
нескольких репозиториях. Он связывает центральный репозиторий спецификаций
(Store), репозитории кода и агента GigaCode (поддерживаются также Claude и Qwen).

- **Store** хранит требования, Changes и бизнес-контекст продукта.
- **Репозитории кода** подключаются к Store и получают команды OpenSpec для агента.
- **Агент** получает контекст проекта через MCP: планирует в Store, реализует в
  каждом репозитории отдельно.

Orchestrator не управляет моделью, её сессиями и разрешениями. OpenSpec ведёт
требования и жизненный цикл Change. Ревью, CI, развёртывание, приёмка и выпуск
остаются за командой.

## Быстрый старт

Нужны Node.js 22.16.0+, Git, OpenSpec 1.11.0 и CLI агента
([установка](docs/user/installation.md)).

```bash
# один раз на машину
openspec-orch agent setup --agent gigacode

# новый проект
mkdir -p ~/work/specs && cd ~/work/specs
openspec-orch init . --store specs --agent gigacode \
  --repo frontend=ssh://git.example.org/product/frontend.git#main
openspec-orch connect
openspec-orch doctor

# первый Change
openspec new change update-copy --schema spec-driven-extended
```

Участник команды вместо `init` клонирует Store и выполняет `connect`
([подробнее](docs/user/join-project.md)).

## Куда идти

| Я хочу | Документ |
|---|---|
| Понять термины | [Основные понятия](docs/user/concepts.md) |
| Установить Orchestrator | [Установка](docs/user/installation.md) |
| Создать проект с нуля | [Создание нового проекта](docs/user/new-project.md) |
| Подключиться к проекту команды | [Подключение к существующему проекту](docs/user/join-project.md) |
| Описать продукт для агента | [Бизнес-контекст](docs/user/project-context.md) |
| Вести Change: Planning → Apply → Verify → Archive | [Работа с Change](docs/user/change/README.md) |
| Обновить версию или мигрировать Store | [Сопровождение](docs/user/maintenance.md) |
| Разобраться с ошибкой | [Диагностика](docs/user/troubleshooting.md) |
| Подключить плагины | [Плагины](docs/plugins/README.md) |
| Создать свой Extension, Plugin или Template | [Создание дополнений](docs/user/creating-addons.md) |

Полное оглавление: [документация для пользователей](docs/user/README.md).
Устройство, конфигурация и разработка Orchestrator описаны в [технической документации](docs/core/README.md).
