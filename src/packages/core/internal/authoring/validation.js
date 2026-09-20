/** @fileoverview Проверка структуры дополнений через существующие runtime contracts. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { parse } from "yaml";
import { PluginPackage } from "@openspec-orch/plugin-sdk";

import { NpmExtensionPackage } from "../extensions/bundled-extension.js";
import { lstatOrNull, requireSafePath } from "../infrastructure/fs.js";
import { ProjectTemplateService } from "../templates/template.js";

/** Отбрасывает небезопасные payload files и проверяет frontmatter навыков. */
async function inspectFiles(root, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (!prefix && [".git", "node_modules"].includes(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`AUTHORING_FILE_INVALID: symlink ${relative}`);
    if (entry.isDirectory()) files.push(...await inspectFiles(root, relative));
    else if (!entry.isFile()) throw new Error(`AUTHORING_FILE_INVALID: не обычный файл ${relative}`);
    else {
      files.push(relative);
      if (entry.name === "SKILL.md") {
        const source = await fs.readFile(path.join(root, relative), "utf8");
        const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
        const metadata = match ? parse(match[1]) : null;
        if (!metadata || typeof metadata.name !== "string" || !metadata.name.trim() ||
            typeof metadata.description !== "string" || !metadata.description.trim()) {
          throw new Error(`AUTHORING_SKILL_INVALID: ${relative}: нужны name и description в YAML frontmatter`);
        }
      }
    }
  }
  return files;
}

/** Проверяет локальный пакет; --load дополнительно исполняет import Plugin в отдельном процессе. */
export async function validateAddon({ kind, root: requestedRoot, agentProvider, load = false }) {
  const root = path.resolve(requestedRoot);
  const stat = await lstatOrNull(root);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error("AUTHORING_ROOT_INVALID: нужен обычный каталог дополнения");
  const files = await inspectFiles(root);
  if (load && kind !== "plugin") throw new Error("AUTHORING_LOAD_INVALID: --load применим только к Plugin");
  const checks = ["ordinary-files", "skill-frontmatter"];
  if (kind === "extension" || kind === "plugin") {
    for (const file of files.filter((file) => /\.(?:js|mjs|cjs)$/u.test(file))) {
      await execa(process.execPath, ["--check", path.join(root, file)], { timeout: 10000 });
    }
    checks.push("javascript-syntax");
  }
  if (kind === "extension") {
    const extension = await NpmExtensionPackage.load(root, { agentIds: agentProvider.catalog.entries.map(({ id }) => id) });
    for (const agentId of Object.keys(extension.manifests)) {
      await agentProvider.adapter.validateExtension(extension, { agentId });
    }
    checks.push("extension-package", "extension-descriptor", "native-manifests");
  } else if (kind === "template") {
    const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-template-check-"));
    try {
      for (const { id } of agentProvider.catalog.entries) {
        await new ProjectTemplateService().plan({ templateRoot: root, targetRoot, agent: agentProvider.resolve(id) });
      }
    } finally {
      await fs.rm(targetRoot, { recursive: true, force: true });
    }
    checks.push("template-copy-plan");
  } else if (kind === "plugin") {
    const manifestPath = await requireSafePath(root, "package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const contract = new PluginPackage(manifest);
    await requireSafePath(root, contract.entrypoint.slice(2));
    checks.push("plugin-package");
    if (load) {
      const { stdout } = await execa(process.execPath, [fileURLToPath(new URL("./validate-plugin.js", import.meta.url)), root], { timeout: 30000 });
      if (!stdout.split(/\r?\n/u).includes("OPENSPEC_PLUGIN_CONTRACT_VERIFIED")) {
        throw new Error("AUTHORING_PLUGIN_CHECK_INCOMPLETE: процесс завершился без подтверждения проверки Plugin contract");
      }
      checks.push("plugin-export-and-commands");
    }
  } else {
    throw new Error("AUTHORING_KIND_INVALID: extension, plugin или template");
  }
  return { kind, root, valid: true, checks, behavior: "not-tested" };
}
