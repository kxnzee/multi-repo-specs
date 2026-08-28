#!/usr/bin/env node

/** @fileoverview Публичная точка входа OpenSpec Orchestrator CLI. */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MINIMUM_NODE_VERSION = "20.19.0";
const require = createRequire(import.meta.url);

/** Проверяет bootstrap runtime до загрузки Core и Plugins. */
function assertNodeVersion(version = process.versions.node) {
  const current = version.split(".").map(Number);
  const supported = current.length === 3 && current.every(Number.isInteger) && (
    current[0] > 20 || (current[0] === 20 && current[1] >= 19)
  );
  if (!supported) {
    throw new Error(
      `OpenSpec Orchestrator требует Node.js ${MINIMUM_NODE_VERSION} или новее; ` +
        `текущая версия: ${version}`,
    );
  }
}

/** Разрешает установленный Plugin package после проверки runtime. */
async function resolvePluginPackage(packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  return {
    manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")),
    root: path.dirname(manifestPath),
  };
}

const templateRoot = fileURLToPath(new URL("../templates/base/", import.meta.url));
const agentRoot = fileURLToPath(new URL("../agents/", import.meta.url));
const extensionRoot = fileURLToPath(new URL("../extensions/", import.meta.url));
const BUNDLED_PLUGINS = Object.freeze([
  Object.freeze({
    id: "change-tracking",
    name: "Change Tracking",
    packageName: "@openspec-orch/plugin-change-tracking",
    rootCommands: Object.freeze(["assign", "status", "record", "verify"]),
  }),
  Object.freeze({
    id: "codegraph",
    name: "CodeGraph",
    packageName: "@openspec-orch/plugin-codegraph",
  }),
  Object.freeze({
    id: "openspec-graph",
    name: "OpenSpec Graph",
    packageName: "@openspec-orch/plugin-openspec-graph",
    rootCommands: Object.freeze(["graph"]),
  }),
]);

/** Безопасно загружает package-каталоги одного bundled registry. */
async function resolveBundledDirectories({ label, load, Provider, root }) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const unsafe = entries.find((entry) => entry.isSymbolicLink());
  if (unsafe) throw new Error(`Bundled ${label} entry не должен быть symlink: ${unsafe.name}`);
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const packages = await Promise.all(directories.map(({ name }) => (
    load(path.join(root, name), name)
  )));
  return new Provider(packages);
}

/** Загружает distribution-owned Agent definitions независимо от Template. */
async function resolveBundledAgents(BundledAgentPackage, BundledAgentProvider) {
  return resolveBundledDirectories({
    label: "Agent",
    load: (root, name) => BundledAgentPackage.load(root, { expectedId: name }),
    Provider: BundledAgentProvider,
    root: agentRoot,
  });
}

/** Загружает все локально поставляемые Extension payloads без списка ID в Core. */
async function resolveBundledExtensions(
  BundledExtensionPackage,
  BundledExtensionProvider,
  agentIds,
) {
  return resolveBundledDirectories({
    label: "Extension",
    load: (root) => BundledExtensionPackage.load(root, { agentIds }),
    Provider: BundledExtensionProvider,
    root: extensionRoot,
  });
}

try {
  assertNodeVersion();
  const [{
    BundledAgentPackage,
    BundledAgentProvider,
    BundledExtensionPackage,
    BundledExtensionProvider,
    BundledPluginPackage,
    BundledPluginProvider,
    createCandidateProgram,
  },
  pluginPackages] = await Promise.all([
    import("@openspec-orch/core"),
    Promise.all(BUNDLED_PLUGINS.map(({ packageName }) => resolvePluginPackage(packageName))),
  ]);
  const bundledProvider = new BundledPluginProvider(BUNDLED_PLUGINS.map((definition, index) => {
    const resolved = pluginPackages[index];
    return new BundledPluginPackage({
      id: definition.id,
      name: definition.name,
      packageName: resolved.manifest.name,
      packageRoot: resolved.root,
      version: resolved.manifest.version,
    });
  }));
  const bundledAgentProvider = await resolveBundledAgents(
    BundledAgentPackage,
    BundledAgentProvider,
  );
  const bundledExtensionProvider = await resolveBundledExtensions(
    BundledExtensionPackage,
    BundledExtensionProvider,
    bundledAgentProvider.catalog.entries.map(({ id }) => id),
  );
  const program = await createCandidateProgram({
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledProvider,
    rootCommands: new Map(BUNDLED_PLUGINS
      .filter(({ rootCommands }) => rootCommands !== undefined)
      .map(({ id, rootCommands }) => [id, rootCommands])),
    templateRoot,
  });
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync(process.argv);
} catch (error) {
  if (typeof error?.code === "string" && error.code.startsWith("commander.")) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    console.error(`openspec-orch: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
