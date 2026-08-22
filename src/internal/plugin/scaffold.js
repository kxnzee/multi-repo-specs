/** @fileoverview Создание самостоятельного Plugin Package без правок Core. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";

import { PLUGIN_ID_SCHEMA } from "../config/plugin.js";
import { lstatOrNull } from "../shared/files.js";
import {
  PLUGIN_DESCRIPTOR_FILE,
  PLUGIN_PACKAGE_API_VERSION,
  PLUGIN_PACKAGE_FILE,
  RESERVED_PLUGIN_IDS,
} from "./constants.js";
import { readPluginPackage } from "./catalog.js";

const SUPPORTED_REPOSITORY_ROLES = new Set(["store", "code"]);

/** Преобразует kebab-case ID в читаемое имя по умолчанию. */
function displayName(pluginId) {
  return pluginId
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** Проверяет authoring input до создания каталога. */
function normalizeRegistration({ pluginId, name, supports = ["code"] }) {
  const parsedId = PLUGIN_ID_SCHEMA.safeParse(pluginId);
  if (!parsedId.success) {
    throw new Error(`PLUGIN_ID_INVALID: plugin-id '${pluginId}' должен быть в lowercase kebab-case`);
  }
  if (RESERVED_PLUGIN_IDS.has(pluginId)) {
    throw new Error(`PLUGIN_ID_RESERVED: plugin-id '${pluginId}' занят встроенной командой CLI`);
  }
  const normalizedSupports = [...new Set(supports)];
  if (
    normalizedSupports.length === 0 ||
    normalizedSupports.some((role) => !SUPPORTED_REPOSITORY_ROLES.has(role))
  ) {
    throw new Error("PLUGIN_SUPPORT_INVALID: --support должен содержать store или code");
  }
  const normalizedName = name?.trim() || displayName(pluginId);
  return { pluginId, name: normalizedName, supports: normalizedSupports };
}

/** Возвращает готовые файлы нового Plugin Package. */
function packageFiles({ pluginId, name, supports }) {
  const entrypoint = `bin/${pluginId}.js`;
  const packageManifest = {
    name: `openspec-orch-plugin-${pluginId}`,
    version: "1.0.0",
    description: `${name} Plugin Package for OpenSpec Orchestrator`,
    type: "module",
    files: ["bin", PLUGIN_DESCRIPTOR_FILE, "README.md"],
    openspecOrchestrator: {
      apiVersion: PLUGIN_PACKAGE_API_VERSION,
      manifest: PLUGIN_DESCRIPTOR_FILE,
      entrypoint,
    },
    engines: { node: ">=20.19.0" },
    license: "UNLICENSED",
  };
  const descriptor = {
    id: pluginId,
    name,
    version: packageManifest.version,
    type: "cli",
    command: pluginId,
    args: [],
    supports,
    lifecycle: {
      connect: ["connect", "."],
      status: ["status", "."],
      sync: ["sync", "."],
    },
  };
  const executable = `#!/usr/bin/env node

const [operation] = process.argv.slice(2);

if (["connect", "status", "sync"].includes(operation)) {
  console.log(\`${pluginId}: \${operation}\`);
} else {
  console.error(\`${pluginId}: реализуйте команду '\${operation ?? ""}' в этом entrypoint\`);
  process.exitCode = 2;
}
`;
  const readme = `# ${name}

Самостоятельный Plugin Package для OpenSpec Orchestrator.

## Разработка

Вся реализация находится в \`${entrypoint}\`. Зависимости добавляйте в локальный
\`package.json\`; изменения Core для этого Plugin не нужны.

После реализации установите Package из корня Store:

\`\`\`bash
openspec-orch plugin init --from <absolute-path-to-this-directory> --plugin ${pluginId}
openspec-orch plugin connect ${pluginId} --repo <repository-id>
\`\`\`
`;
  return new Map([
    [PLUGIN_PACKAGE_FILE, `${JSON.stringify(packageManifest, null, 2)}\n`],
    [PLUGIN_DESCRIPTOR_FILE, stringify(descriptor)],
    [entrypoint, executable],
    ["README.md", readme],
  ]);
}

/**
 * Регистрирует новый Plugin как самостоятельный файловый Package.
 *
 * @param {{pluginId: string, targetRoot: string, name?: string, supports?: string[]}} options
 * @returns {Promise<{root: string, entrypoint: string}>} Созданные package paths.
 */
export async function registerPluginPackage({ pluginId, targetRoot, name, supports }) {
  const registration = normalizeRegistration({ pluginId, name, supports });
  const requestedRoot = path.resolve(targetRoot);
  if (await lstatOrNull(requestedRoot)) {
    throw new Error(`PLUGIN_TARGET_EXISTS: каталог уже существует: ${requestedRoot}`);
  }
  const parent = path.dirname(requestedRoot);
  await fs.mkdir(parent, { recursive: true });
  const canonicalParent = await fs.realpath(parent);
  const root = path.join(canonicalParent, path.basename(requestedRoot));
  if (await lstatOrNull(root)) {
    throw new Error(`PLUGIN_TARGET_EXISTS: каталог уже существует: ${root}`);
  }
  const temporaryRoot = await fs.mkdtemp(path.join(canonicalParent, `.${pluginId}-`));
  try {
    for (const [relativePath, contents] of packageFiles(registration)) {
      const target = path.join(temporaryRoot, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, "utf8");
    }
    const entrypoint = path.join(temporaryRoot, "bin", `${pluginId}.js`);
    await fs.chmod(entrypoint, 0o755);
    await readPluginPackage(temporaryRoot);
    await fs.rename(temporaryRoot, root);
    return { root, entrypoint: path.join(root, "bin", `${pluginId}.js`) };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
