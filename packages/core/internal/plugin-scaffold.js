/** @fileoverview Создание нативного Plugin package на публичном SDK. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { PluginPackage, PLUGIN_API_VERSION } from "@openspec-orch/plugin-sdk";

import { CORE_CLI_COMMANDS, CORE_PACKAGES, CORE_PACKAGE_VERSIONS, CORE_PATTERNS } from "./constants.js";

const REPOSITORY_ROLES = new Set(["store", "code"]);

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Преобразует kebab-case ID в читаемое имя. */
function displayName(pluginId) {
  return pluginId
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Нормализует пользовательские параметры scaffold. */
function normalize({ pluginId, name, supports = ["code"] }) {
  if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
    throw new Error(`PLUGIN_ID_INVALID: plugin-id '${pluginId ?? ""}' должен быть lowercase kebab-case`);
  }
  if (CORE_CLI_COMMANDS.reserved.includes(pluginId)) {
    throw new Error(`PLUGIN_ID_RESERVED: plugin-id '${pluginId}' занят командой CLI`);
  }
  if (!Array.isArray(supports)) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  const roles = [...new Set(supports)];
  if (roles.length === 0 || roles.some((role) => !REPOSITORY_ROLES.has(role))) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    throw new Error("PLUGIN_NAME_INVALID: --name должен быть непустой строкой");
  }
  return Object.freeze({ pluginId, name: name?.trim() ?? displayName(pluginId), supports: roles });
}

/** Формирует минимальные файлы самостоятельного Plugin package. */
function scaffoldFiles({ pluginId, name, supports }) {
  const sdkVersion = `^${CORE_PACKAGE_VERSIONS.pluginSdk}`;
  const manifest = {
    name: `openspec-orch-plugin-${pluginId}`,
    version: "1.0.0",
    description: `${name} Plugin for OpenSpec Orchestrator`,
    type: "module",
    exports: "./index.js",
    files: ["index.js", "README.md"],
    openspecOrchestrator: { apiVersion: PLUGIN_API_VERSION, plugin: "./index.js" },
    peerDependencies: { [CORE_PACKAGES.pluginSdk]: sdkVersion },
    devDependencies: { [CORE_PACKAGES.pluginSdk]: sdkVersion },
    scripts: { test: "node --test" },
    engines: { node: ">=20.19.0" },
    license: "UNLICENSED",
  };
  new PluginPackage(manifest);
  const entrypoint = `/** @fileoverview ${name} Plugin. */

import { definePlugin } from "${CORE_PACKAGES.pluginSdk}";

export default definePlugin({
  id: "${pluginId}",
  supports: ${JSON.stringify(supports)},
  repository: {
    async connect() {},
    async status() {
      return { state: "ready" };
    },
  },
  registerCommands(commands) {
    commands.command("inspect")
      .description("Проверить загрузку Plugin")
      .action(() => {
        console.log("${pluginId}: ready");
      });
  },
});
`;
  const contractTest = `/** @fileoverview Contract test ${name} Plugin. */

import { promises as fs } from "node:fs";
import { testPluginContract } from "${CORE_PACKAGES.pluginSdk}/testing";

import plugin from "../index.js";

const packageManifest = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);

testPluginContract({ plugin, packageManifest });
`;
  const readme = `# ${name}

Нативный Plugin для OpenSpec Orchestrator. Вся логика находится в \`index.js\` и
использует только публичный \`${CORE_PACKAGES.pluginSdk}\`.

\`\`\`bash
npm install
npm test
openspec-orch plugin init --plugin ${pluginId} --from .
openspec-orch plugin connect ${pluginId} --repo <repository-id>
openspec-orch ${pluginId} inspect
\`\`\`
`;
  return new Map([
    ["package.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["index.js", entrypoint],
    ["README.md", readme],
    ["test/plugin.test.js", contractTest],
  ]);
}

/** Создаёт самостоятельный Plugin package без изменений Core. */
export class PluginScaffoldService {
  async register({ pluginId, targetRoot, name, supports } = {}) {
    const registration = normalize({ pluginId, name, supports });
    if (typeof targetRoot !== "string" || targetRoot.length === 0) {
      throw new Error("PLUGIN_TARGET_INVALID: target path обязателен");
    }
    const requestedRoot = path.resolve(targetRoot);
    if (await lstatOrNull(requestedRoot)) {
      throw new Error(`PLUGIN_TARGET_EXISTS: каталог уже существует: ${requestedRoot}`);
    }
    await fs.mkdir(path.dirname(requestedRoot), { recursive: true });
    const parent = await fs.realpath(path.dirname(requestedRoot));
    const root = path.join(parent, path.basename(requestedRoot));
    const temporaryRoot = await fs.mkdtemp(path.join(parent, `.${pluginId}-`));
    try {
      for (const [relativePath, contents] of scaffoldFiles(registration)) {
        const target = path.join(temporaryRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, contents, { encoding: "utf8", flag: "wx" });
      }
      await fs.rename(temporaryRoot, root);
      return Object.freeze({ root, entrypoint: path.join(root, "index.js") });
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

export const pluginScaffolds = Object.freeze(new PluginScaffoldService());
