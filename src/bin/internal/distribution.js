/** @fileoverview Shared composition root for public CLI and MCP adapters. */

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import {
  AGENT_GATEWAY_EXTENSION_ID,
  BUNDLED_ROOTS,
  DISTRIBUTION_CONFIG,
  MINIMUM_NODE_PARTS,
  MINIMUM_NODE_VERSION,
} from "./distribution-config.js";

const require = createRequire(import.meta.url);

export { DISTRIBUTION_CONFIG } from "./distribution-config.js";

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

/** Runs a Plugin-owned native runtime declared by a bundled Plugin package. */
export async function runBundledPluginRuntime(pluginId, args) {
  const definition = DISTRIBUTION_CONFIG.plugins.find(({ id }) => id === pluginId);
  if (!definition) throw new Error(`PLUGIN_RUNTIME_NOT_BUNDLED: ${pluginId ?? ""}`);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("PLUGIN_RUNTIME_INVALID: args должен быть массивом строк");
  }
  const { manifest, root } = await resolvePluginPackage(definition.packageName);
  const runtime = manifest?.openspecOrchestrator?.runtime;
  if (
    typeof runtime !== "string" || !runtime.startsWith("./") || runtime.includes("\\") ||
    runtime.split("/").some((part) => part === "" || part === "..")
  ) {
    throw new Error(`PLUGIN_RUNTIME_UNAVAILABLE: ${pluginId}`);
  }
  const runtimePath = path.resolve(root, runtime);
  if (!runtimePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`PLUGIN_RUNTIME_UNAVAILABLE: ${pluginId}`);
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtimePath, ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`PLUGIN_RUNTIME_FAILED: ${pluginId} завершён сигналом ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`PLUGIN_RUNTIME_FAILED: ${pluginId} завершён с кодом ${code ?? 1}`));
    });
  });
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

/** Loads the bundled Agent definitions shared by CLI composition and verification. */
export async function loadBundledAgentProvider() {
  const core = await import("@openspec-orch/core");
  return resolveBundledDirectories({
    label: "Agent",
    load: (root, name) => core.BundledAgentPackage.load(root, { expectedId: name }),
    Provider: core.BundledAgentProvider,
    root: BUNDLED_ROOTS.agents,
  });
}

/** Builds the one distribution Platform used by every public protocol adapter. */
export async function createDistributionPlatform({ start, loadInstalledPlugins = true }) {
  const core = await import("@openspec-orch/core");
  const pluginPackages = await Promise.all(
    DISTRIBUTION_CONFIG.plugins.map(({ packageName }) => resolvePluginPackage(packageName)),
  );
  const bundledPackages = DISTRIBUTION_CONFIG.plugins.map(
    (definition, index) => {
      const resolved = pluginPackages[index];
      return new core.BundledPluginPackage({
        id: definition.id,
        name: definition.name,
        packageName: resolved.manifest.name,
        packageRoot: resolved.root,
        recommended: definition.recommended,
        version: resolved.manifest.version,
      });
    },
  );
  const bundledProvider = new core.BundledPluginProvider(bundledPackages);
  const bundledAgentProvider = await loadBundledAgentProvider();
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
    pluginCommandOptions: {
      scaffoldService: new core.PluginScaffoldService({
        extensionTemplateRoots: bundledAgentProvider.extensionTemplateRoots,
      }),
    },
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledTemplateProvider,
    bundledProvider,
    ...(loadInstalledPlugins ? {} : { loadedPlugins: [] }),
    start,
  });
  const loadAgentContributions = async () => {
    const bundledContributions = (await Promise.all(
      bundledPackages.map(async (pluginPackage) => {
        const installation = await bundledProvider.resolve({
          id: pluginPackage.id,
          source: pluginPackage.source.declaration,
        });
        const { plugin } = installation.loadedPlugin;
        return typeof plugin.hasAgentContribution === "function" && plugin.hasAgentContribution()
          ? Object.freeze({
            pluginId: plugin.id,
            contribution: plugin.agentContribution(),
          })
          : null;
      }),
    )).filter(Boolean);
    const contributions = new Map(bundledContributions.map((entry) => [entry.pluginId, entry]));
    for (const entry of platform.agentContributions) contributions.set(entry.pluginId, entry);
    return Object.freeze([...contributions.values()]);
  };
  return Object.freeze({
    agentGatewayService,
    loadAgentContributions,
    managerService: new core.PluginManagerService({ bundledProvider }),
    platform,
  });
}
