/** @fileoverview Claude Plugin protocol: inspect, install and safely remove marketplace entries. */

import path from "node:path";
import process from "node:process";

import {
  assertInstalledPayload,
  createNativeExtensionAdapter,
  readNativeManifest,
  runNative,
  unselectedManifestPaths,
} from "./native-extension.js";
import { AGENT_ADAPTER_CONFIG } from "./config.js";

/** Resolves the native project, including a process facade without cwd. */
async function projectDirectory(context, scope) {
  if (scope === "user") return undefined;
  if (typeof context.process.cwd === "string") return context.process.cwd;
  const cwd = (await context.process.run(process.execPath, ["-p", "process.cwd()"])).trim();
  if (!path.isAbsolute(cwd)) throw new Error("AGENT_EXTENSION_SCOPE_INVALID: project cwd недоступен");
  return cwd;
}

/** Parses Claude's machine-readable Plugin inventory. */
function parsePluginList(output) {
  try {
    const plugins = JSON.parse(output);
    if (Array.isArray(plugins)) return plugins;
  } catch (cause) {
    throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list вернул некорректный JSON", { cause });
  }
  throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list должен вернуть массив");
}

/** Reads the native Plugin registration once for status and safe removal. */
async function inspectPlugin({ context, extension, protocol }) {
  const output = await runNative(context, extension, [protocol.commands.group, protocol.commands.list, "--json"]);
  return Object.freeze({ output, plugins: parsePluginList(output) });
}

/** Finds the exact Plugin registration for its requested scope and project. */
function matchingPlugin(plugins, qualifiedId, scope, projectPath) {
  return plugins.find((plugin) => (
    plugin.id === qualifiedId &&
    (scope === undefined || plugin.scope === scope) &&
    (projectPath === undefined || (
      typeof plugin.projectPath === "string" && path.resolve(plugin.projectPath) === path.resolve(projectPath)
    ))
  ));
}

/** Explains whether a missing exact registration has the wrong scope or project. */
function assertInstalledPlugin(plugins, qualifiedId, scope, projectPath) {
  const plugin = matchingPlugin(plugins, qualifiedId, scope, projectPath);
  const matchingId = plugins.filter(({ id }) => id === qualifiedId);
  const matchingScope = matchingId.filter((candidate) => scope === undefined || candidate.scope === scope);
  if (!plugin && scope !== undefined && matchingScope.length === 0 && matchingId.length > 0) {
    throw new Error(`AGENT_EXTENSION_STATUS_SCOPE_MISSING: ${qualifiedId} (${scope})`);
  }
  if (!plugin && projectPath !== undefined && matchingScope.length > 0) {
    throw new Error(`AGENT_EXTENSION_STATUS_PROJECT_MISMATCH: ${qualifiedId} (${projectPath})`);
  }
  if (!plugin) throw new Error(`AGENT_EXTENSION_STATUS_MISSING: ${qualifiedId}`);
  if (plugin.enabled !== true) throw new Error(`AGENT_EXTENSION_STATUS_DISABLED: ${qualifiedId}`);
  return plugin;
}

/** Validates the Claude Plugin and its one-entry local marketplace. */
async function validateExtension(extension, _agent, protocol, { nativeId = extension.id } = {}) {
  const files = protocol.files;
  const plugin = await readNativeManifest(path.join(extension.root, files.directory, files.manifest), extension.root);
  if (plugin.name !== nativeId) {
    throw new Error(`AGENT_EXTENSION_INVALID: Claude manifest name '${plugin.name ?? ""}' не совпадает с native ID '${nativeId}'`);
  }
  const marketplace = await readNativeManifest(
    path.join(extension.root, files.directory, files.marketplace), extension.root,
  );
  const expectedMarketplace = `${files.marketplacePrefix}${nativeId}`;
  const [marketplacePlugin] = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  if (marketplace.name !== expectedMarketplace || marketplace.plugins?.length !== 1 ||
    marketplacePlugin?.name !== nativeId || marketplacePlugin?.source !== files.marketplaceSource) {
    throw new Error(`AGENT_EXTENSION_INVALID: Claude marketplace должен объявлять ${nativeId} в ${expectedMarketplace}`);
  }
}

/** Builds Claude's marketplace and qualified Plugin identifiers. */
function pluginIdentity(nativeId, protocol) {
  const marketplaceId = `${protocol.files.marketplacePrefix}${nativeId}`;
  return Object.freeze({ marketplaceId, qualifiedId: `${nativeId}@${marketplaceId}` });
}

/** Verifies one Claude Plugin registration without auditing its installed files. */
async function statusPlugin({ context, extension, nativeId, protocol, request }) {
  const { qualifiedId } = pluginIdentity(nativeId, protocol);
  const scope = request.scope ?? context.agent.scope;
  const projectPath = await projectDirectory(context, scope);
  const state = await inspectPlugin({ context, extension, protocol });
  assertInstalledPlugin(state.plugins, qualifiedId, scope, projectPath);
  return state.output;
}

/** Performs the deep installed-payload audit reserved for Doctor. */
async function diagnosePlugin({ context, extension, nativeId, protocol, request }) {
  const { qualifiedId } = pluginIdentity(nativeId, protocol);
  const scope = request.scope ?? context.agent.scope;
  const projectPath = await projectDirectory(context, scope);
  const state = await inspectPlugin({ context, extension, protocol });
  const plugin = assertInstalledPlugin(state.plugins, qualifiedId, scope, projectPath);
  await assertInstalledPayload(extension, plugin.installPath, {
    ignoredPaths: unselectedManifestPaths(extension, context.agent.id),
  });
  return state.output;
}

/** Registers the marketplace, installs, updates and verifies one Plugin. */
async function connectPlugin(input, protocol) {
  const { context, extension, nativeId, request, validateExtension: validate } = input;
  const { marketplaceId, qualifiedId } = pluginIdentity(nativeId, protocol);
  const scope = request.scope ?? context.agent.scope;
  await validate(extension, context.agent, { nativeId });
  await runNative(context, extension, [protocol.commands.group, protocol.commands.marketplace, protocol.commands.add, extension.root, "--scope", scope]);
  await runNative(context, extension, [protocol.commands.group, protocol.commands.install, qualifiedId, "--scope", scope]);
  await runNative(context, extension, [protocol.commands.group, protocol.commands.update, qualifiedId, "--scope", scope]);
  return statusPlugin({ context, extension, nativeId, protocol, request, marketplaceId });
}

/** Removes one registration and its marketplace only when no registration remains. */
async function removePlugin({ context, extension, nativeId, protocol, request }) {
  const { marketplaceId, qualifiedId } = pluginIdentity(nativeId, protocol);
  const scope = request.scope ?? context.agent.scope;
  const projectPath = await projectDirectory(context, scope);
  const installed = await inspectPlugin({ context, extension, protocol });
  const current = matchingPlugin(installed.plugins, qualifiedId, scope, projectPath);
  if (!current) return "";
  await runNative(context, extension, [protocol.commands.group, protocol.commands.uninstall, qualifiedId, "--scope", scope]);
  const remaining = await inspectPlugin({ context, extension, protocol });
  if (remaining.plugins.some(({ id }) => id === qualifiedId)) return "";
  return runNative(context, extension, [protocol.commands.group, protocol.commands.marketplace, protocol.commands.remove, marketplaceId, "--scope", scope]);
}

/** Creates an adapter for the Claude marketplace Plugin grammar. */
export function createClaudePluginLifecycle({ protocol } = AGENT_ADAPTER_CONFIG.claude) {
  const validate = (extension, agent, options) => validateExtension(extension, agent, protocol, options);
  return createNativeExtensionAdapter({
    validateExtension: validate,
    operations: Object.freeze({
      connect: (input) => connectPlugin(input, protocol),
      diagnose: (input) => diagnosePlugin({ ...input, protocol }),
      status: (input) => statusPlugin({ ...input, protocol }),
      disconnect: (input) => removePlugin({ ...input, protocol }),
      remove: (input) => removePlugin({ ...input, protocol }),
    }),
  });
}
