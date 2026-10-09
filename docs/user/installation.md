# Установка

Этот шаг выполняется один раз на каждой машине. После него переходите к
[созданию проекта](new-project.md) или [подключению к существующему проекту](join-project.md).

## 1. Требования

- Node.js 22.16.0 или новее, npm и Git;
- OpenSpec 1.11.0, доступный как команда `openspec`;
- CLI агента GigaCode: команда `gigacode`.

OpenSpec устанавливается способом, разрешённым в вашей среде, например:

```bash
npm install --global @fission-ai/openspec@1.11.0
openspec --version
```

## 2. Установка Orchestrator

### Из Git

Исходники кладутся в тот же workspace, что и проект, рядом со Store (см.
[раскладку каталогов](concepts.md#раскладка-каталогов)).

> **Не называйте workspace `openspec`.** Каталог, в котором лежат Orchestrator и
> Store, должен называться иначе, например `work` или по имени продукта. С именем
> `openspec` команды завершаются ошибкой.

Используйте согласованный тег или коммит, а не вершину ветки:

```bash
git clone <orchestrator-repository-url> /absolute/path/to/workspace/openspec-orchestrator
cd /absolute/path/to/workspace/openspec-orchestrator
git checkout <approved-tag-or-commit>
npm ci
npm link
openspec-orch --version
```

Каталог `openspec-orchestrator/` нужен только для установки. Не запускайте в нём
`init` и не используйте его как Store: Store создаётся отдельно, в
`<workspace>/specs/`. То же относится к каталогу npm-пакета и к репозиториям кода.

После смены версии Node.js повторите `npm link`. Если глобальная ссылка запрещена,
запускайте файл напрямую:

```bash
node /absolute/path/to/workspace/openspec-orchestrator/src/bin/openspec-orch.js --help
```

### Из npm-реестра

Если согласованный выпуск опубликован в доступном реестре:

```bash
npm install --global openspec-orchestrator@<exact-version>
openspec-orch --version
```

Внешние Plugins и Extensions проекта ставятся отдельно: они зафиксированы в
`package.json` и `package-lock.json` Store и восстанавливаются командой `connect`.

Для разработки самого Orchestrator глобальные установки не нужны, см.
[техническое руководство](../core/development.md).

## 3. Проверка окружения

```bash
node --version
git --version
openspec --version
openspec-orch --help
gigacode --version
```

`gigacode` должен быть в `PATH` до первого `connect`: команда проверяет его
раньше, чем подключает репозитории и расширения.

## 4. Шлюз агента

Шлюз даёт агенту доступ к контексту и инструментам Orchestrator через MCP. Он
ставится в пользовательскую область агента, один раз на машину, и используется
всеми проектами этого агента:

```bash
openspec-orch agent setup --agent gigacode
openspec-orch agent status --agent gigacode
```

После установки перезапустите GigaCode. `agent status` только проверяет установку; повторное подключение
после обновления: `agent setup --agent gigacode --refresh`.

Для Claude и Qwen команды те же с другим `--agent`, см.
[Claude и Qwen](other-agents.md).

Обновление, откат и переход на новую версию описаны в [сопровождении](maintenance.md).
