/** @fileoverview Создание самостоятельных дополнений без Store и Agent session. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { stringify } from "yaml";
import { ExtensionDescriptor, ExtensionPackage } from "@openspec-orch/extension-sdk";

import { lstatOrNull } from "../infrastructure/fs.js";
import { PluginScaffoldService, extensionTemplateFiles } from "../plugin-runtime/plugin-scaffold.js";
import { validateAddon } from "./validation.js";

/** Проверяет общие поля до создания каталогов. */
function identity(id, name = id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new Error("AUTHORING_ID_INVALID: ID должен состоять из строчных слов через дефис");
  }
  if (typeof name !== "string" || !name.trim() || /[\r\n]/u.test(name) || name.includes(String.fromCharCode(0))) {
    throw new Error("AUTHORING_NAME_INVALID: название должно быть непустой строкой без переносов");
  }
  return { id, name: name.trim() };
}

/** README содержит отдельные действия в пакете и в тестовом Store. */
function readme({ id, name, kind, editable, profile }) {
  const install = kind === "template"
    ? `При создании нового Store передайте абсолютный путь этой папки через --template.\nПример: openspec-orch init /absolute/path/to/new-store --store specs --agent qwen --template /absolute/path/to/${id}`
    : `Из корня отдельного тестового Store выполните:\n\n\`\`\`bash\nopenspec-orch ${kind} init ${kind === "plugin" ? `--plugin ${id}` : id} --from /absolute/path/to/${id}\n${kind === "extension" ? `openspec-orch extension connect ${id}\nopenspec-orch extension status ${id}` : `openspec-orch plugin exec ${id} ${profile === "native" ? "--help" : "inspect"}`}\nopenspec-orch doctor\n\`\`\``;
  return `# ${name}\n\nТип: ${kind}. Редактируйте: ${editable.join(", ")}.\n\n` +
    `Из папки дополнения запустите \`openspec-orch create validate . --kind ${kind}\`.\n` +
    (kind === "plugin" ? "После реализации выполните `npm install`, `npm test` и `openspec-orch create validate . --kind plugin --load`. Проверка --load импортирует ваш JavaScript.\n" : "") +
    (kind === "plugin" && profile !== "commands" ? "Реализуйте connect/status перед подключением; для native также реализуйте bin/. Перед plugin exec подключите Plugin в тестовом Store: `openspec-orch plugin connect " + id + " --repo repository-id`.\n" : "") +
    (kind === "template" ? "Этот минимальный Template копирует контекст. Он полностью заменяет содержимое default; его схемы и Extensions не наследуются.\n" : "") +
    `\n## Попробовать\n\n${install}\n\n` +
    "Проверка структуры не подтверждает прикладное поведение. Выполните реальный сценарий; для Extension откройте новую сессию выбранного агента.\n" +
    (kind === "template" ? "" : "Перед передачей команде выполните `npm pack --dry-run`, проверьте содержимое пакета и закрепите точную версию или Git revision. После изменения payload повышайте version пакета и native manifests.\n");
}

/** Генерирует пакет и проверяет техническую структуру до публикации каталога. */
export class AddonAuthoringService {
  #agents;

  constructor({ agentProvider }) {
    this.#agents = agentProvider;
  }

  async create({ kind, id, name, targetRoot = id, agents, targets = ["store"], profile = "commands", supports, extension = false }) {
    const named = identity(id, name);
    if (!["extension", "plugin", "template"].includes(kind)) throw new Error("AUTHORING_KIND_INVALID: extension, plugin или template");
    const selected = agents ?? this.#agents.catalog.entries.map(({ id: agentId }) => agentId);
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length) {
      throw new Error("AUTHORING_AGENTS_INVALID: выберите уникальные Agent IDs");
    }
    const definitions = selected.map((agentId) => this.#agents.resolve(agentId));
    // Native protocols can share marketplace files; preserve the complete provider payload.
    const roots = this.#agents.extensionTemplateRoots;
    if (typeof targetRoot !== "string" || !targetRoot.trim()) throw new Error("AUTHORING_PATH_INVALID: укажите каталог");
    const destination = path.resolve(targetRoot);
    if (await lstatOrNull(destination)) throw new Error(`AUTHORING_TARGET_EXISTS: каталог уже существует: ${destination}`);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "orch-authoring-"));
    const staging = path.join(temporary, id);
    let reserved = false;
    try {
      let editable;
      if (kind === "plugin") {
        await new PluginScaffoldService({ extensionTemplateRoots: roots }).register({
          pluginId: id, name: named.name, targetRoot: staging, profile, supports, extension,
        });
        if (extension) {
          for (const agentId of selected) {
            await this.#agents.adapter.validateExtension({ id: "agent", root: path.join(staging, "extension") }, { agentId, ownerId: id });
          }
        }
        editable = ["index.js", ...(profile === "native" ? [`bin/${id}.js`] : []), ...(extension ? ["extension/agent-instructions.md"] : [])];
      } else {
        await fs.mkdir(staging);
        const files = new Map();
        if (kind === "extension") {
          const descriptor = { ...named, targets, manifests: Object.fromEntries(definitions.map((agent) => [agent.id, agent.manifest])) };
          new ExtensionDescriptor(descriptor, { agentIds: selected });
          const manifest = { name: `openspec-orch-extension-${id}`, version: "1.0.0", type: "module", license: "UNLICENSED", openspecOrchestrator: { apiVersion: 1, extension: "./extension.yaml" } };
          new ExtensionPackage(manifest);
          files.set("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
          files.set("extension.yaml", stringify(descriptor));
          for (const [file, contents] of await extensionTemplateFiles({ pluginId: id, name: named.name, extensionId: id }, roots)) {
            files.set(file.slice("extension/".length), contents);
          }
          files.set("agent-instructions.md", `# ${named.name}\n\nДля этой задачи используй навык ${id}.\n`);
          files.set(`skills/${id}/SKILL.md`, `---\n${stringify({ name: id, description: `${named.name}: используйте для согласованной с автором задачи.` })}---\n\n# ${named.name}\n\nОпишите входные данные, действия агента, ожидаемый результат и способ его проверки.\n`);
          editable = [`skills/${id}/SKILL.md`, "agent-instructions.md"];
        } else {
          files.set("template.yaml", stringify({ ...named, agentInstructions: "assets/agent-instructions.md", copy: [{ from: "context", to: "openspec/context" }] }));
          files.set("context/README.md", `# ${named.name}\n\nОпишите назначение проекта, участников и ограничения.\n`);
          files.set("assets/agent-instructions.md", "# Контекст проекта\n\nПеред работой прочитайте openspec/context/README.md.\n");
          editable = ["context/README.md", "assets/agent-instructions.md", "template.yaml"];
        }
        for (const [file, contents] of files) {
          const target = path.join(staging, file);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, contents, { flag: "wx" });
        }
      }
      await fs.writeFile(path.join(staging, "README.md"), readme({ ...named, kind, editable, profile }));
      const validation = await validateAddon({ kind, root: staging, agentProvider: this.#agents });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Exclusive mkdir refuses a target created concurrently, including an empty directory.
      await fs.mkdir(destination);
      reserved = true;
      await fs.cp(staging, destination, { recursive: true, errorOnExist: true, force: false });
      const root = await fs.realpath(destination);
      return { kind, id, root, editable, validation: { ...validation, root }, next: { command: "openspec-orch", args: ["create", "validate", root, "--kind", kind] }, behavior: "not-tested" };
    } catch (error) {
      if (reserved) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
