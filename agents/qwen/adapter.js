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
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

/** Escapes one native ID before matching the stable first line of Qwen list output. */
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Requires the requested Extension to be enabled in the current workspace. */
function assertExtensionEnabled(output, nativeId, scope) {
  const plain = output.replace(ANSI_ESCAPE, "");
  const entry = plain.split(/\n\s*\n/gu).find((block) => (
    new RegExp(`^[✓✗]\\s+${escapePattern(nativeId)}\\s+\\(`, "u").test(block)
  ));
  if (!entry) {
    throw new Error(`AGENT_EXTENSION_STATUS_MISSING: ${nativeId}`);
  }
  if (!entry.startsWith("✓")) {
    throw new Error(`AGENT_EXTENSION_STATUS_DISABLED: ${nativeId}`);
  }
  if (scope !== undefined) {
    const label = `${scope[0].toUpperCase()}${scope.slice(1)}`;
    if (!entry.includes(`Enabled (${label}): true`)) {
      throw new Error(`AGENT_EXTENSION_STATUS_SCOPE_MISSING: ${nativeId} (${scope})`);
    }
  }
}

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
    const activationScope = request.scope ?? WORKSPACE_SCOPE;
    const installationScope = request.scope ?? context.agent.scope;
    let args;
    if (request.operation === "connect") {
      await this.validateExtension(extension, context.agent, { nativeId: resolvedNativeId });
      try {
        return await runNative(context, extension, [
          "extensions", "enable", resolvedNativeId, "--scope", activationScope,
        ]);
      } catch (error) {
        if (!isMissingExtension(error, resolvedNativeId)) throw error;
        args = [
          "extensions", "install", `${extension.root}:${resolvedNativeId}`,
          "--scope", installationScope, "--consent",
        ];
      }
    } else if (request.operation === "status") {
      const output = await runNative(context, extension, ["extensions", "list"]);
      assertExtensionEnabled(output, resolvedNativeId, request.scope);
      return output;
    } else if (request.operation === "remove") {
      args = ["extensions", "uninstall", resolvedNativeId];
    } else {
      args = ["extensions", "disable", resolvedNativeId, "--scope", activationScope];
    }
    return runNative(context, extension, args);
  },
});

export default qwenAdapter;
