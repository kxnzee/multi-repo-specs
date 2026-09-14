# Разработка расширений

Standalone Extension добавляет агенту инструкции, навыки, команды и provider
manifests. Это декларативный npm-пакет: Core не загружает из него JavaScript и не
выполняет произвольный код. Для исполняемого поведения используйте Plugin и его
[руководство для разработчика](../plugins/development.md).

## Состав package

В `package.json` укажите точную версию пакета и descriptor Extension:

```json
{
  "name": "@company/openspec-workflow-extension",
  "version": "1.0.0",
  "openspecOrchestrator": {
    "apiVersion": 1,
    "extension": "./extension.yaml"
  }
}
```

Значение `extension` всегда равно `./extension.yaml`. API версии 1 не принимает
исполняемый entrypoint. Файлы, указанные в descriptor, должны находиться внутри
package и быть обычными файлами.

## Descriptor

`extension.yaml` содержит ID, понятное имя, manifest каждого поддерживаемого Agent
и область подключения:

```yaml
id: workflow-extension
name: Workflow Extension
targets: [store, code]
manifests:
  claude: .claude-plugin/plugin.json
  qwen: qwen-extension.json
  gigacode: gigacode-extension.json
```

`id` — lowercase kebab-case. `manifests` должен содержать хотя бы один известный
Agent ID: `claude`, `qwen` или `gigacode`. Пути указываются относительно package,
в POSIX-формате без `.` и `..`.

`targets` необязателен: по умолчанию Extension подключается только к Store.
Допустимые значения — `store`, `code` или оба без повторов. Выбирайте `code` лишь
когда инструкции или команды действительно нужны в репозиториях реализации.

## Проверка контракта

Подключите `@openspec-orch/extension-sdk` как devDependency и добавьте обычный
Node test. Он проверяет manifest и descriptor без запуска agent payload:

```js
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { testExtensionContract } from "@openspec-orch/extension-sdk/testing";

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const descriptor = parse(await readFile(new URL("../extension.yaml", import.meta.url), "utf8"));

testExtensionContract({
  agentIds: ["claude", "qwen", "gigacode"],
  packageManifest,
  descriptor,
});
```

Дополнительно проверьте, что каждый путь из `manifests` существует и provider CLI
принимает его manifest. Contract test не доказывает, что Agent загрузил payload.

## Установка в тестовый Store

Сначала зафиксируйте исходный package в отдельной версии, tarball или immutable Git
revision. Затем выполните lifecycle из корня тестового Store:

```bash
openspec-orch extension init workflow-extension \
  --from @company/openspec-workflow-extension@1.0.0
openspec-orch extension connect workflow-extension
openspec-orch extension status workflow-extension
openspec-orch doctor
```

Проверьте native status выбранного Agent и откройте новую Agent-сессию. После этого
проверьте отключение и удаление по [общему lifecycle](../plugins/operations.md).
`package.json`, lockfile и `openspec-orch.yaml` Store должны пройти review вместе.

## Границы ответственности

Extension не создаёт Changes, не меняет Git, не выполняет Verify, Archive или
Release и не подтверждает результат разработки. Шаблон может объявить обязательные
Extensions, но не устанавливает внешние packages автоматически. Plugin-owned
Extension создаётся и отключается вместе с binding Plugin; её контракт описан в
[документации Plugin SDK](../plugins/development.md#extensions).
