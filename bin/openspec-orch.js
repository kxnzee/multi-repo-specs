#!/usr/bin/env node

/** @fileoverview Публичная точка входа OpenSpec Orchestrator CLI. */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PACKAGE_MANIFEST = require("../package.json");
const DISTRIBUTION_CONFIG = Object.freeze({
  defaultTemplateId: PACKAGE_MANIFEST.openspecOrchestrator.defaultTemplateId,
  plugins: Object.freeze(PACKAGE_MANIFEST.openspecOrchestrator.bundledPlugins.map((plugin) => (
    Object.freeze({
      ...plugin,
      rootCommands: plugin.rootCommands === undefined
        ? undefined
        : Object.freeze([...plugin.rootCommands]),
    })
  ))),
});
const MINIMUM_NODE_VERSION = PACKAGE_MANIFEST.engines.node.replace(/^>=/u, "");
const MINIMUM_NODE_PARTS = Object.freeze(MINIMUM_NODE_VERSION.split(".").map(Number));

/** Сравнивает exact runtime version с minimum из package manifest. */
function isSupportedNodeVersion(version) {
  const current = version.split(".").map(Number);
  if (current.length !== MINIMUM_NODE_PARTS.length || !current.every(Number.isInteger)) return false;
  const firstDifference = current.findIndex((part, index) => part !== MINIMUM_NODE_PARTS[index]);
  return firstDifference === -1 || current[firstDifference] > MINIMUM_NODE_PARTS[firstDifference];
}

/** Проверяет bootstrap runtime до загрузки Core и Plugins. */
function assertNodeVersion(version = process.versions.node) {
  if (!isSupportedNodeVersion(version)) {
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

const BUNDLED_ROOTS = Object.freeze({
  agents: fileURLToPath(new URL("../agents/", import.meta.url)),
  extensions: fileURLToPath(new URL("../extensions/", import.meta.url)),
  templates: fileURLToPath(new URL("../templates/", import.meta.url)),
});

/** Безопасно загружает package-каталоги одного bundled registry. */
async function resolveBundledDirectories({ label, load, Provider, providerOptions, root }) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const unsafe = entries.find((entry) => entry.isSymbolicLink());
  if (unsafe) throw new Error(`Bundled ${label} entry не должен быть symlink: ${unsafe.name}`);
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const packages = await Promise.all(directories.map(({ name }) => (
    load(path.join(root, name), name)
  )));
  return new Provider(packages, providerOptions);
}

/** Загружает distribution-owned Agent definitions независимо от Template. */
async function resolveBundledAgents(BundledAgentPackage, BundledAgentProvider) {
  return resolveBundledDirectories({
    label: "Agent",
    load: (root, name) => BundledAgentPackage.load(root, { expectedId: name }),
    Provider: BundledAgentProvider,
    root: BUNDLED_ROOTS.agents,
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
    root: BUNDLED_ROOTS.extensions,
  });
}

/** Загружает все локально поставляемые Project Templates без списка ID в Core. */
async function resolveBundledTemplates(
  BundledTemplatePackage,
  BundledTemplateProvider,
  defaultTemplateId,
) {
  return resolveBundledDirectories({
    label: "Template",
    load: (root, name) => BundledTemplatePackage.load(root, { expectedId: name }),
    Provider: BundledTemplateProvider,
    providerOptions: { defaultId: defaultTemplateId },
    root: BUNDLED_ROOTS.templates,
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
    BundledTemplatePackage,
    BundledTemplateProvider,
    createCandidateProgram,
  },
  pluginPackages] = await Promise.all([
    import("@openspec-orch/core"),
    Promise.all(DISTRIBUTION_CONFIG.plugins.map(
      ({ packageName }) => resolvePluginPackage(packageName),
    )),
  ]);
  const bundledProvider = new BundledPluginProvider(DISTRIBUTION_CONFIG.plugins.map(
    (definition, index) => {
      const resolved = pluginPackages[index];
      return new BundledPluginPackage({
        id: definition.id,
        name: definition.name,
        packageName: resolved.manifest.name,
        packageRoot: resolved.root,
        version: resolved.manifest.version,
      });
    },
  ));
  const bundledAgentProvider = await resolveBundledAgents(
    BundledAgentPackage,
    BundledAgentProvider,
  );
  const bundledExtensionProvider = await resolveBundledExtensions(
    BundledExtensionPackage,
    BundledExtensionProvider,
    bundledAgentProvider.catalog.entries.map(({ id }) => id),
  );
  const bundledTemplateProvider = await resolveBundledTemplates(
    BundledTemplatePackage,
    BundledTemplateProvider,
    DISTRIBUTION_CONFIG.defaultTemplateId,
  );
  const program = await createCandidateProgram({
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledProvider,
    bundledTemplateProvider,
    rootCommands: new Map(DISTRIBUTION_CONFIG.plugins
      .filter(({ rootCommands }) => rootCommands !== undefined)
      .map(({ id, rootCommands }) => [id, rootCommands])),
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
