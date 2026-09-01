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
const QWEN_SCOPE_MARKERS = Object.freeze({
  user: Object.freeze(["Enabled (User): true"]),
  workspace: Object.freeze(["Enabled (Workspace): true"]),
});

/** Escapes one native ID before matching the stable first line of Qwen list output. */
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Находит Extension по стабильному native ID без разбора локализованных полей. */
function findExtensionEntry(output, nativeId) {
  const plain = output.replace(ANSI_ESCAPE, "");
  return plain.split(/\n\s*\n/gu).find((block) => (
    new RegExp(`^[✓✗]\\s+${escapePattern(nativeId)}\\s+\\(`, "u").test(block)
  ));
}

/** Requires the requested Extension to be enabled in the current workspace. */
function assertExtensionEnabled(output, nativeId, scope, scopeMarkers) {
  const entry = findExtensionEntry(output, nativeId);
  if (!entry) {
    throw new Error(`AGENT_EXTENSION_STATUS_MISSING: ${nativeId}`);
  }
  if (!entry.startsWith("✓")) {
    throw new Error(`AGENT_EXTENSION_STATUS_DISABLED: ${nativeId}`);
  }
  if (scope !== undefined) {
    if (!scopeMarkers[scope]?.some((marker) => entry.includes(marker))) {
      throw new Error(`AGENT_EXTENSION_STATUS_SCOPE_MISSING: ${nativeId} (${scope})`);
    }
  }
}

/** Создаёт Qwen-compatible adapter с Agent-owned маркерами status scope. */
export function createQwenCompatibleAdapter({ scopeMarkers = QWEN_SCOPE_MARKERS } = {}) {
  return Object.freeze({
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
        const output = await runNative(context, extension, ["extensions", "list"]);
        args = findExtensionEntry(output, resolvedNativeId)
          ? [
            "extensions", "enable", resolvedNativeId, "--scope", activationScope,
          ]
          : [
            "extensions", "install", `${extension.root}:${resolvedNativeId}`,
            "--scope", installationScope, "--consent",
          ];
      } else if (request.operation === "status") {
        const output = await runNative(context, extension, ["extensions", "list"]);
        assertExtensionEnabled(output, resolvedNativeId, request.scope, scopeMarkers);
        return output;
      } else if (request.operation === "remove") {
        args = ["extensions", "uninstall", resolvedNativeId];
      } else {
        args = ["extensions", "disable", resolvedNativeId, "--scope", activationScope];
      }
      return runNative(context, extension, args);
    },
  });
}

/** Native Qwen Extension adapter. */
const qwenAdapter = createQwenCompatibleAdapter();

export default qwenAdapter;
