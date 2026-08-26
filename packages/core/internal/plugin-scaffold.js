/** @fileoverview Создание нативного Plugin package на публичном SDK. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { PluginPackage, PLUGIN_API_VERSION } from "@openspec-orch/plugin-sdk";

import { CORE_CLI_COMMANDS, CORE_PACKAGES, CORE_PACKAGE_VERSIONS, CORE_PATTERNS } from "./constants.js";

const REPOSITORY_ROLES = new Set(["store", "code"]);
const PLUGIN_PROFILES = new Set(["commands", "repository", "native"]);

const EMPTY_PLUGIN_TEMPLATE = "agents: {}\n";

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
function normalize({ pluginId, name, profile = "commands", supports, template = false }) {
  if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
    throw new Error(`PLUGIN_ID_INVALID: plugin-id '${pluginId ?? ""}' должен быть lowercase kebab-case`);
  }
  if (CORE_CLI_COMMANDS.reserved.includes(pluginId)) {
    throw new Error(`PLUGIN_ID_RESERVED: plugin-id '${pluginId}' занят командой CLI`);
  }
  if (!PLUGIN_PROFILES.has(profile)) {
    throw new Error("PLUGIN_PROFILE_INVALID: --profile должен быть commands, repository или native");
  }
  if (typeof template !== "boolean") {
    throw new Error("PLUGIN_TEMPLATE_INVALID: template должен быть boolean");
  }
  if (profile === "commands" && supports !== undefined) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support доступен только для repository и native");
  }
  const requestedSupports = supports ?? (profile === "commands" ? [] : ["code"]);
  if (!Array.isArray(requestedSupports)) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  const roles = [...new Set(requestedSupports)];
  if (
    (profile !== "commands" && roles.length === 0) ||
    roles.some((role) => !REPOSITORY_ROLES.has(role))
  ) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
    throw new Error("PLUGIN_NAME_INVALID: --name должен быть непустой строкой");
  }
  return Object.freeze({
    pluginId,
    name: name?.trim() ?? displayName(pluginId),
    profile,
    supports: roles,
    template,
  });
}

/** Формирует минимальные файлы самостоятельного Plugin package. */
function scaffoldFiles({ pluginId, name, profile, supports, template }) {
  const sdkVersion = `^${CORE_PACKAGE_VERSIONS.pluginSdk}`;
  const packagedFiles = [
    "index.js",
    "README.md",
    ...(profile === "native" ? ["bin"] : []),
    ...(template ? ["template"] : []),
  ];
  const manifest = {
    name: `openspec-orch-plugin-${pluginId}`,
    version: "1.0.0",
    description: `${name} Plugin for OpenSpec Orchestrator`,
    type: "module",
    exports: "./index.js",
    files: packagedFiles,
    openspecOrchestrator: { apiVersion: PLUGIN_API_VERSION, plugin: "./index.js" },
    peerDependencies: { [CORE_PACKAGES.pluginSdk]: sdkVersion },
    devDependencies: { [CORE_PACKAGES.pluginSdk]: sdkVersion },
    scripts: { test: "node --test" },
    engines: { node: ">=20.19.0" },
    license: "UNLICENSED",
  };
  new PluginPackage(manifest);
  const nativeImports = profile === "native"
    ? `import process from "node:process";
import { fileURLToPath } from "node:url";

`
    : "";
  const launcher = profile === "native"
    ? `const launcher = fileURLToPath(new URL("./bin/${pluginId}.js", import.meta.url));

`
    : "";
  const repository = profile === "commands"
    ? ""
    : `  repository: {
    connect() {
      throw new Error("PLUGIN_CONNECT_NOT_IMPLEMENTED");
    },
    status() {
      throw new Error("PLUGIN_STATUS_NOT_IMPLEMENTED");
    },${profile === "native" ? `
    exec(context, args) {
      return context.process.run(process.execPath, [launcher, ...args]);
    },` : ""}
  },
`;
  const commands = profile === "native"
    ? ""
    : `  registerCommands(commands) {
    commands.command("inspect")
      .description("Проверить загрузку Plugin")
      .action(() => {
        console.log("${pluginId}: ready");
      });
  },
`;
  const entrypoint = `/** @fileoverview ${name} Plugin. */

${nativeImports}import { definePlugin } from "${CORE_PACKAGES.pluginSdk}";

${launcher}export default definePlugin({
  id: "${pluginId}",
${profile === "commands" ? "" : `  supports: ${JSON.stringify(supports)},\n`}
${repository}${commands}});
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
  const usage = profile === "commands"
    ? `openspec-orch ${pluginId} inspect`
    : profile === "repository"
      ? `openspec-orch plugin connect ${pluginId} --repo <repository-id>
openspec-orch ${pluginId} inspect
openspec-orch plugin exec ${pluginId} --repo <repository-id> -- inspect`
      : `openspec-orch plugin connect ${pluginId} --repo <repository-id>
openspec-orch plugin exec ${pluginId} --repo <repository-id> -- --help`;
  const readme = `# ${name}

Профиль: \`${profile}\`. Вся логика находится в \`index.js\` и использует только
публичный \`${CORE_PACKAGES.pluginSdk}\`.

\`\`\`bash
npm install
npm test
openspec-orch plugin init --plugin ${pluginId} --from .
${usage}
\`\`\`

${profile === "repository" ? "Реализуйте lifecycle `connect/status` перед установкой. `plugin exec` автоматически исполняет grammar из `registerCommands`." : ""}
${profile === "native" ? "Реализуйте native runtime в `bin/` и lifecycle `connect/status` перед установкой." : ""}
${template ? "Plugin Template находится в `template/`; добавьте assets и copy operations в `template.yaml`." : ""}
`;
  return new Map([
    ["package.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["index.js", entrypoint],
    ["README.md", readme],
    ["test/plugin.test.js", contractTest],
    ...(profile === "native"
      ? [[`bin/${pluginId}.js`, `#!/usr/bin/env node

throw new Error("NATIVE_RUNTIME_NOT_IMPLEMENTED");
`]]
      : []),
    ...(template ? [["template/template.yaml", EMPTY_PLUGIN_TEMPLATE]] : []),
  ]);
}

/** Создаёт самостоятельный Plugin package без изменений Core. */
export class PluginScaffoldService {
  async register({ pluginId, targetRoot, name, profile, supports, template } = {}) {
    const registration = normalize({ pluginId, name, profile, supports, template });
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
