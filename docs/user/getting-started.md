# Начало работы

## 1. Проверьте окружение

```bash
node --version
npm --version
git --version
openspec --version
openspec-orch --help
```

Нужен Node.js 20.19.0 или новее. Установка и обновление самого Orchestrator описаны
[отдельно](installation-and-updates.md).

## 2. Создайте или клонируйте Store

Сначала проверьте локальные регистрации OpenSpec:

```bash
openspec store list
```

`--store` задаёт ID, уникальный на этой машине: один Store ID может указывать
только на один локальный checkout. Для нового Store выберите свободный ID.

```bash
openspec-orch init /absolute/path/to/workspace/specs \
  --store specs \
  --agent qwen \
  --repo frontend=ssh://git.example.org/product/frontend.git#main \
  --repo backend=ssh://git.example.org/product/backend.git#main
```

В TTY можно запустить `openspec-orch init` без обязательных флагов и пройти
интерактивный выбор. В non-TTY обязательны `--store` и `--agent`.

Template `default` добавляет Extensions `spec-driven-extended` и `superpowers`. Plugins
он не устанавливает.

### Существующий Store

Новый участник не запускает `init` поверх существующего Store. Клонируйте принятую
ветку или revision и убедитесь, что локальный Store ID не занят другим checkout:

```bash
git clone <store-remote> /absolute/path/to/workspace/specs
cd /absolute/path/to/workspace/specs
git checkout <approved-branch-or-revision>
openspec store list
```

Дальше выполняйте обычный `connect` из следующего раздела. Он регистрирует Store в
OpenSpec, подключает Code Repositories, восстанавливает standalone Extensions и
Plugin-owned Extensions из portable bindings. После `connect` обязательно проверьте
`doctor`, `repository status`, Agent gateway и Plugin status. Если Store ID уже указывает
на другой путь, сначала разрешите конфликт локальной регистрации; не изменяйте identity
клонированного Store.

## 3. Подключите машину

```bash
cd /absolute/path/to/workspace/specs
openspec-orch connect
openspec-orch doctor
openspec-orch repository status
```

В strict mode отсутствующие Code Repositories клонируются в `<workspace>/src/`.
Существующие checkout не обновляются и должны соответствовать configured remote,
branch и clean-state требованиям.

В strict mode для другой раскладки один раз передайте workspace:

```bash
openspec-orch connect --workspace /absolute/path/to/workspace
```

Relaxed mode (`--no-strict`) не клонирует repositories и не проверяет Git pinning;
нужные каталоги должны уже существовать. Явный `--workspace` действует только на
текущий relaxed-вызов и не сохраняется. Для последующего Plugin/Repository flow
используйте стандартную раскладку либо strict project с сохранённым workspace.

## 4. При необходимости установите Agent gateway

```bash
openspec-orch agent setup --agent qwen
openspec-orch agent status --agent qwen
```

Перезапустите Agent после установки. Gateway ставится в user scope и используется
всеми Projects этого Agent.

## 5. Подключите нужные Plugins

Например, для проверки Store graph:

```bash
openspec-orch plugin init --plugin openspec-graph
openspec-orch plugin connect openspec-graph --repo specs
openspec-orch graph inspect --json
```

Остальные варианты описаны в [руководстве Plugins](plugins.md).

## 6. Создайте Change

```bash
openspec new change update-copy --schema spec-driven-extended
# либо
openspec new change redesign-checkout --schema superspec-multirepo
```

Дальше используйте [личный](solo-flow.md) или [командный](team-flow.md) процесс.

Для нового участника итоговая последовательность выглядит так:

```text
clone Store → connect → doctor → repository status
→ agent setup/status → plugin status → перезапуск Agent → работа с Change
```
