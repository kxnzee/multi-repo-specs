/** @fileoverview Native Claude Plugin adapter. */

import path from "node:path";
import process from "node:process";

import {
  adaptOpenSpecPack,
  nativeExtensionId,
  preflightNative,
  readNativeManifest,
  runNative,
} from "../native-extension.js";

/** Resolves the native project even through a Plugin process facade without a cwd getter. */
async function projectDirectory(context, scope) {
  if (scope === "user") return undefined;
  if (typeof context.process.cwd === "string") return context.process.cwd;
  const cwd = (await context.process.run(process.execPath, ["-p", "process.cwd()"])).trim();
  if (!path.isAbsolute(cwd)) throw new Error("AGENT_EXTENSION_SCOPE_INVALID: project cwd недоступен");
  return cwd;
}

/** Requires the requested Claude Plugin to be installed and enabled. */
function assertPluginEnabled(output, qualifiedId, scope, projectPath) {
  let plugins;
  try {
    plugins = JSON.parse(output);
  } catch (cause) {
    throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list вернул некорректный JSON", {
      cause,
    });
  }
  if (!Array.isArray(plugins)) {
    throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list должен вернуть массив");
  }
  const plugin = plugins.find(({
    id,
    scope: candidateScope,
    projectPath: candidateProjectPath,
  }) => (
    id === qualifiedId &&
    (scope === undefined || candidateScope === scope) &&
    (projectPath === undefined || (
      typeof candidateProjectPath === "string" &&
      path.resolve(candidateProjectPath) === path.resolve(projectPath)
    ))
  ));
  const matchingId = plugins.filter(({ id }) => id === qualifiedId);
  const matchingScope = matchingId.filter(({ scope: candidateScope }) => (
    scope === undefined || candidateScope === scope
  ));
  if (!plugin && scope !== undefined && matchingScope.length === 0 && matchingId.length > 0) {
    throw new Error(`AGENT_EXTENSION_STATUS_SCOPE_MISSING: ${qualifiedId} (${scope})`);
  }
  if (!plugin && projectPath !== undefined && matchingScope.length > 0) {
    throw new Error(`AGENT_EXTENSION_STATUS_PROJECT_MISMATCH: ${qualifiedId} (${projectPath})`);
  }
  if (!plugin) throw new Error(`AGENT_EXTENSION_STATUS_MISSING: ${qualifiedId}`);
  if (plugin.enabled !== true) {
    throw new Error(`AGENT_EXTENSION_STATUS_DISABLED: ${qualifiedId}`);
  }
}

/** Claude Plugin lifecycle через локальный marketplace checkout. */
const claudeAdapter = Object.freeze({
  adaptOpenSpecPack,
  preflight: preflightNative,

  async validateExtension(extension, _agent, { nativeId = extension.id } = {}) {
    const plugin = await readNativeManifest(
      path.join(extension.root, ".claude-plugin", "plugin.json"),
      extension.root,
    );
    if (plugin.name !== nativeId) {
      throw new Error(
        `AGENT_EXTENSION_INVALID: Claude manifest name '${plugin.name ?? ""}' ` +
          `не совпадает с native ID '${nativeId}'`,
      );
    }
    const marketplace = await readNativeManifest(
      path.join(extension.root, ".claude-plugin", "marketplace.json"),
      extension.root,
    );
    const expectedMarketplace = `openspec-orch-${nativeId}`;
    const [marketplacePlugin] = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    if (
      marketplace.name !== expectedMarketplace ||
      marketplace.plugins?.length !== 1 ||
      marketplacePlugin?.name !== nativeId ||
      marketplacePlugin?.source !== "./"
    ) {
      throw new Error(
        `AGENT_EXTENSION_INVALID: Claude marketplace должен объявлять ` +
          `${nativeId} в ${expectedMarketplace}`,
      );
    }
  },

  async invokeExtension(context, extension, request) {
    const resolvedNativeId = nativeExtensionId(extension.id, request.ownerId);
    const resolvedMarketplaceId = `openspec-orch-${resolvedNativeId}`;
    const qualifiedId = `${resolvedNativeId}@${resolvedMarketplaceId}`;
    const scope = request.scope ?? context.agent.scope;
    if (request.operation === "connect") {
      await this.validateExtension(extension, context.agent, { nativeId: resolvedNativeId });
      await runNative(context, extension, [
        "plugin", "marketplace", "add", extension.root, "--scope", scope,
      ]);
      return runNative(context, extension, [
        "plugin", "install", qualifiedId, "--scope", scope,
      ]);
    }
    if (request.operation === "status") {
      const output = await runNative(context, extension, ["plugin", "list", "--json"]);
      assertPluginEnabled(
        output,
        qualifiedId,
        scope,
        await projectDirectory(context, scope),
      );
      return output;
    }
    const projectPath = await projectDirectory(context, scope);
    const installed = JSON.parse(await runNative(context, extension, ["plugin", "list", "--json"]));
    if (!Array.isArray(installed)) {
      throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list должен вернуть массив");
    }
    const current = installed.some((plugin) => plugin.id === qualifiedId && plugin.scope === scope &&
      (scope === "user" || (typeof plugin.projectPath === "string" &&
        path.resolve(plugin.projectPath) === path.resolve(projectPath))));
    if (!current) return "";
    await runNative(context, extension, [
      "plugin", "uninstall", qualifiedId, "--scope", scope,
    ]);
    const remaining = JSON.parse(await runNative(context, extension, ["plugin", "list", "--json"]));
    if (!Array.isArray(remaining)) {
      throw new Error("AGENT_EXTENSION_STATUS_INVALID: Claude plugin list должен вернуть массив");
    }
    // Marketplace registration is shared by installations in different projects/scopes.
    if (remaining.some(({ id }) => id === qualifiedId)) return "";
    return runNative(context, extension, [
      "plugin", "marketplace", "remove", resolvedMarketplaceId, "--scope", scope,
    ]);
  },
});

export default claudeAdapter;
