/** @fileoverview Native Qwen-compatible Extension adapter. */

import path from "node:path";

import {
  adaptOpenSpecPack,
  nativeExtensionId,
  preflightNative,
  readNativeManifest,
  runNative,
} from "../native-extension.js";

const WORKSPACE_SCOPE = "workspace";

/** Отличает отсутствие package от прочих native CLI failures. */
function isMissingExtension(error, nativeId) {
  return error.message?.includes(`Extension with name ${nativeId} does not exist.`) === true;
}

/** Общая CLI grammar Qwen и GigaCode с разными Agent definitions/manifests. */
const qwenAdapter = Object.freeze({
  adaptOpenSpecPack,
  preflight: preflightNative,

  async validateExtension(extension, agent, { nativeId = extension.id } = {}) {
    const manifest = await readNativeManifest(
      path.join(extension.root, agent.manifest),
      extension.root,
    );
    if (manifest.name !== nativeId) {
      throw new Error(
        `AGENT_EXTENSION_INVALID: ${agent.manifest} name '${manifest.name ?? ""}' ` +
          `не совпадает с native ID '${nativeId}'`,
      );
    }
  },

  async invokeExtension(context, extension, request) {
    const resolvedNativeId = nativeExtensionId(extension.id, request.ownerId);
    let args;
    if (request.operation === "connect") {
      await this.validateExtension(extension, context.agent, { nativeId: resolvedNativeId });
      try {
        return await runNative(context, extension, [
          "extensions", "enable", resolvedNativeId, "--scope", WORKSPACE_SCOPE,
        ]);
      } catch (error) {
        if (!isMissingExtension(error, resolvedNativeId)) throw error;
        args = [
          "extensions", "install", `${extension.root}:${resolvedNativeId}`,
          "--scope", context.agent.scope, "--consent",
        ];
      }
    } else if (request.operation === "status") {
      args = ["extensions", "list"];
    } else {
      args = ["extensions", "disable", resolvedNativeId, "--scope", WORKSPACE_SCOPE];
    }
    return runNative(context, extension, args);
  },
});

export default qwenAdapter;
