/** @fileoverview Создание нативного Plugin package на публичном SDK. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PluginPackage,
  PLUGIN_API_VERSION,
  PLUGIN_PATTERNS,
  REPOSITORY_ROLE,
} from "@openspec-orch/plugin-sdk";

import { CORE_CLI_COMMANDS, CORE_PACKAGES, CORE_PACKAGE_VERSIONS } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { PLUGIN_SCAFFOLD_CONFIG, PLUGIN_SCAFFOLD_PROFILE } from "./plugin-scaffold-config.js";

const REPOSITORY_ROLES = new Set(Object.values(REPOSITORY_ROLE));
const PLUGIN_PROFILES = new Set(PLUGIN_SCAFFOLD_CONFIG.profiles);
const PLUGIN_EXTENSION_TEMPLATE_ROOT = fileURLToPath(
  new URL("../templates/plugin-extension/", import.meta.url),
);

/** Рекурсивно читает все файлы package-owned Plugin Extension Template. */
async function extensionTemplatePaths(root = PLUGIN_EXTENSION_TEMPLATE_ROOT, prefix = "") {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw new Error(`PLUGIN_EXTENSION_TEMPLATE_INVALID: symlink запрещён: ${entry.name}`);
    }
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await extensionTemplatePaths(absolutePath, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".template")) {
      paths.push(relativePath.slice(0, -".template".length));
    } else {
      throw new Error(`PLUGIN_EXTENSION_TEMPLATE_INVALID: ожидается *.template: ${relativePath}`);
    }
  }
  return paths;
}

/** Преобразует kebab-case ID в читаемое имя. */
function displayName(pluginId) {
  return pluginId
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Нормализует пользовательские параметры scaffold. */
function normalize({
  pluginId,
  name,
  profile = PLUGIN_SCAFFOLD_CONFIG.defaultProfile,
  supports,
  extension = false,
}) {
  if (typeof pluginId !== "string" || !PLUGIN_PATTERNS.id.test(pluginId)) {
    throw new Error(`PLUGIN_ID_INVALID: plugin-id '${pluginId ?? ""}' должен быть lowercase kebab-case`);
  }
  if (CORE_CLI_COMMANDS.reserved.includes(pluginId)) {
    throw new Error(`PLUGIN_ID_RESERVED: plugin-id '${pluginId}' занят командой CLI`);
  }
  if (!PLUGIN_PROFILES.has(profile)) {
    throw new Error("PLUGIN_PROFILE_INVALID: --profile должен быть commands, repository или native");
  }
  if (typeof extension !== "boolean") {
    throw new Error("PLUGIN_EXTENSION_INVALID: extension должен быть boolean");
  }
  if (profile === PLUGIN_SCAFFOLD_PROFILE.commands && extension) {
    throw new Error(
      "PLUGIN_EXTENSION_INVALID: --extension доступен только для repository и native",
    );
  }
  if (profile === PLUGIN_SCAFFOLD_PROFILE.commands && supports !== undefined) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support доступен только для repository и native");
  }
  const requestedSupports = supports ?? (
    profile === PLUGIN_SCAFFOLD_PROFILE.commands ? [] : [REPOSITORY_ROLE.code]
  );
  if (!Array.isArray(requestedSupports)) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  const roles = [...new Set(requestedSupports)];
  if (
    (profile !== PLUGIN_SCAFFOLD_PROFILE.commands && roles.length === 0) ||
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
    extension,
  });
}

/** Материализует Agent artifacts из package-owned Plugin Extension Template. */
async function extensionTemplateFiles({ pluginId, name }) {
  const extensionName = `${pluginId}-agent`;
  const values = new Map([
    ["__EXTENSION_NAME_JSON__", JSON.stringify(extensionName)],
    ["__EXTENSION_DESCRIPTION_JSON__", JSON.stringify(`${name} Agent Extension`)],
    ["__MARKETPLACE_NAME_JSON__", JSON.stringify(`openspec-orch-${extensionName}`)],
    ["__PLUGIN_DISPLAY_NAME__", name],
    ["__PLUGIN_DISPLAY_NAME_JSON__", JSON.stringify(name)],
  ]);
  const templatePaths = await extensionTemplatePaths();
  return Promise.all(templatePaths.map(async (relativePath) => {
    let contents = await fs.readFile(
      path.join(PLUGIN_EXTENSION_TEMPLATE_ROOT, `${relativePath}.template`),
      "utf8",
    );
    for (const [token, value] of values) contents = contents.replaceAll(token, () => value);
    return [`extension/${relativePath}`, contents];
  }));
}

/** Формирует минимальные файлы самостоятельного Plugin package. */
async function scaffoldFiles({ pluginId, name, profile, supports, extension }) {
  const sdkVersion = `^${CORE_PACKAGE_VERSIONS.pluginSdk}`;
  const packagedFiles = [
    "index.js",
    "README.md",
    ...(profile === PLUGIN_SCAFFOLD_PROFILE.native ? ["bin"] : []),
    ...(extension ? ["extension"] : []),
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
    engines: { node: ">=22.16.0" },
    license: "UNLICENSED",
  };
  new PluginPackage(manifest);
  const nativeImports = profile === PLUGIN_SCAFFOLD_PROFILE.native
    ? `import process from "node:process";
import { fileURLToPath } from "node:url";

`
    : "";
  const launcher = profile === PLUGIN_SCAFFOLD_PROFILE.native
    ? `const launcher = fileURLToPath(new URL("./bin/${pluginId}.js", import.meta.url));

`
    : "";
  const repository = profile === PLUGIN_SCAFFOLD_PROFILE.commands
    ? ""
    : `  repository: {
    connect() {
      throw new Error("PLUGIN_CONNECT_NOT_IMPLEMENTED");
    },
    status() {
      throw new Error("PLUGIN_STATUS_NOT_IMPLEMENTED");
    },${profile === PLUGIN_SCAFFOLD_PROFILE.native ? `
    exec(context, args) {
      return context.process.run(process.execPath, [launcher, ...args]);
    },` : ""}
  },
`;
  const commands = profile === PLUGIN_SCAFFOLD_PROFILE.native
    ? ""
    : `  registerCommands(commands) {
    commands.command("inspect")
      .description("Проверить загрузку Plugin")
      .action(() => {
        console.log("${pluginId}: ready");
      });
  },
`;
  const extensions = extension
    ? `  extensions(context) {
    return [{ id: "agent", root: "./extension", target: context.repository }];
  },
`
    : "";
  const entrypoint = `/** @fileoverview ${name} Plugin. */

${nativeImports}import { definePlugin } from "${CORE_PACKAGES.pluginSdk}";

${launcher}export default definePlugin({
  id: "${pluginId}",
${profile === PLUGIN_SCAFFOLD_PROFILE.commands ? "" : `  supports: ${JSON.stringify(supports)},\n`}
${extensions}${repository}${commands}});
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
  const usage = profile === PLUGIN_SCAFFOLD_PROFILE.commands
    ? `openspec-orch ${pluginId} inspect`
    : profile === PLUGIN_SCAFFOLD_PROFILE.repository
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

${profile === PLUGIN_SCAFFOLD_PROFILE.repository ? "Реализуйте lifecycle `connect/status` перед установкой. `plugin exec` автоматически исполняет grammar из `registerCommands`." : ""}
${profile === PLUGIN_SCAFFOLD_PROFILE.native ? "Реализуйте native runtime в `bin/` и lifecycle `connect/status` перед установкой." : ""}
${extension ? "Agent Extension находится в `extension/` и подключается штатным lifecycle текущего Agent." : ""}
`;
  return new Map([
    ["package.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["index.js", entrypoint],
    ["README.md", readme],
    ["test/plugin.test.js", contractTest],
    ...(profile === PLUGIN_SCAFFOLD_PROFILE.native
      ? [[`bin/${pluginId}.js`, `#!/usr/bin/env node

throw new Error("NATIVE_RUNTIME_NOT_IMPLEMENTED");
`]]
      : []),
    ...(extension ? await extensionTemplateFiles({ pluginId, name }) : []),
  ]);
}

/** Создаёт самостоятельный Plugin package без изменений Core. */
export class PluginScaffoldService {
  async register({ pluginId, targetRoot, name, profile, supports, extension } = {}) {
    const registration = normalize({ pluginId, name, profile, supports, extension });
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
      for (const [relativePath, contents] of await scaffoldFiles(registration)) {
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
