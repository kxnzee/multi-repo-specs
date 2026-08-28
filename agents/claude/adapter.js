/** @fileoverview Native Claude Plugin adapter. */

import path from "node:path";

import {
  adaptOpenSpecPack,
  nativeExtensionId,
  preflightNative,
  readNativeManifest,
  runNative,
} from "../native-extension.js";

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
    if (request.operation === "connect") {
      await this.validateExtension(extension, context.agent, { nativeId: resolvedNativeId });
      await runNative(context, extension, [
        "plugin", "marketplace", "add", extension.root, "--scope", context.agent.scope,
      ]);
      return runNative(context, extension, [
        "plugin", "install", qualifiedId, "--scope", context.agent.scope,
      ]);
    }
    if (request.operation === "status") {
      return runNative(context, extension, ["plugin", "list", "--json"]);
    }
    await runNative(context, extension, [
      "plugin", "uninstall", qualifiedId, "--scope", context.agent.scope,
    ]);
    return runNative(context, extension, [
      "plugin", "marketplace", "remove", resolvedMarketplaceId, "--scope", context.agent.scope,
    ]);
  },
});

export default claudeAdapter;
