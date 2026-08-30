/** @fileoverview Shared composition root for public CLI and MCP adapters. */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PACKAGE_MANIFEST = require("../../package.json");
const MINIMUM_NODE_VERSION = PACKAGE_MANIFEST.engines.node.replace(/^>=/u, "");
const MINIMUM_NODE_PARTS = Object.freeze(MINIMUM_NODE_VERSION.split(".").map(Number));

export const DISTRIBUTION_CONFIG = Object.freeze({
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

const BUNDLED_ROOTS = Object.freeze({
  agents: fileURLToPath(new URL("../../agents/", import.meta.url)),
  extensions: fileURLToPath(new URL("../../extensions/", import.meta.url)),
  templates: fileURLToPath(new URL("../../templates/", import.meta.url)),
});
const AGENT_GATEWAY_EXTENSION_ID = "orchestrator-agent";

/** Compares one runtime version with the distribution floor. */
function isSupportedNodeVersion(version) {
  const current = version.split(".").map(Number);
  if (current.length !== MINIMUM_NODE_PARTS.length || !current.every(Number.isInteger)) return false;
  const firstDifference = current.findIndex((part, index) => part !== MINIMUM_NODE_PARTS[index]);
  return firstDifference === -1 || current[firstDifference] > MINIMUM_NODE_PARTS[firstDifference];
}

/** Guards the distribution before dynamically loading Core and Plugins. */
export function assertNodeVersion(version) {
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `OpenSpec Orchestrator требует Node.js ${MINIMUM_NODE_VERSION} или новее; ` +
        `текущая версия: ${version}`,
    );
  }
}

/** Resolves one bundled Plugin package without importing its runtime yet. */
async function resolvePluginPackage(packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  return {
    manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")),
    root: path.dirname(manifestPath),
  };
}

/** Loads one sorted bundled catalog from ordinary child directories. */
async function resolveBundledDirectories({ label, load, Provider, providerOptions, root }) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const unsafe = entries.find((entry) => entry.isSymbolicLink());
  if (unsafe) throw new Error(`Bundled ${label} entry не должен быть symlink: ${unsafe.name}`);
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const packages = await Promise.all(directories.map(({ name }) => load(path.join(root, name), name)));
  return new Provider(packages, providerOptions);
}

/** Builds the one distribution Platform used by every public protocol adapter. */
export async function createDistributionPlatform({ start }) {
  const core = await import("@openspec-orch/core");
  const pluginPackages = await Promise.all(
    DISTRIBUTION_CONFIG.plugins.map(({ packageName }) => resolvePluginPackage(packageName)),
  );
  const bundledProvider = new core.BundledPluginProvider(DISTRIBUTION_CONFIG.plugins.map(
    (definition, index) => {
      const resolved = pluginPackages[index];
      return new core.BundledPluginPackage({
        id: definition.id,
        name: definition.name,
        packageName: resolved.manifest.name,
        packageRoot: resolved.root,
        version: resolved.manifest.version,
      });
    },
  ));
  const bundledAgentProvider = await resolveBundledDirectories({
    label: "Agent",
    load: (root, name) => core.BundledAgentPackage.load(root, { expectedId: name }),
    Provider: core.BundledAgentProvider,
    root: BUNDLED_ROOTS.agents,
  });
  const bundledExtensionProvider = await resolveBundledDirectories({
    label: "Extension",
    load: (root) => core.BundledExtensionPackage.load(root, {
      agentIds: bundledAgentProvider.catalog.entries.map(({ id }) => id),
    }),
    Provider: core.BundledExtensionProvider,
    providerOptions: { catalogExcludeIds: [AGENT_GATEWAY_EXTENSION_ID] },
    root: BUNDLED_ROOTS.extensions,
  });
  const bundledTemplateProvider = await resolveBundledDirectories({
    label: "Template",
    load: (root, name) => core.BundledTemplatePackage.load(root, { expectedId: name }),
    Provider: core.BundledTemplateProvider,
    providerOptions: { defaultId: DISTRIBUTION_CONFIG.defaultTemplateId },
    root: BUNDLED_ROOTS.templates,
  });
  const agentGatewayService = new core.AgentGatewayService({
    agentProvider: bundledAgentProvider,
    extensionId: AGENT_GATEWAY_EXTENSION_ID,
    extensionProvider: bundledExtensionProvider,
    start,
  });
  const platform = await core.PluginPlatform.create({
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledTemplateProvider,
    bundledProvider,
    rootCommands: new Map(DISTRIBUTION_CONFIG.plugins
      .filter(({ rootCommands }) => rootCommands !== undefined)
      .map(({ id, rootCommands }) => [id, rootCommands])),
    start,
  });
  return Object.freeze({
    agentGatewayService,
    managerService: new core.PluginManagerService({ bundledProvider }),
    platform,
  });
}
