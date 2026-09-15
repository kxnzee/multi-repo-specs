/** @fileoverview Qwen-compatible Extension protocol: inspect, install and activate. */

import path from "node:path";

import {
  assertInstalledPayload,
  createNativeExtensionAdapter,
  readNativeManifest,
  runNative,
  unselectedManifestPaths,
} from "./native-extension.js";
import { AGENT_ADAPTER_CONFIG } from "./config.js";

/** Escapes one Extension ID for the native list heading matcher. */
function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Returns one native Extension record without relying on localized labels. */
function findExtensionEntry(output, nativeId, protocol) {
  const plain = output.replace(protocol.ansiEscape, "");
  return plain.split(/\n\s*\n/gu).find((block) => (
    new RegExp(`^[${protocol.statusHeading.enabled}${protocol.statusHeading.disabled}]\\s+${escapePattern(nativeId)}\\s+\\(`, "u").test(block)
  ));
}

/** Extracts the installation path from supported CLI locales. */
function installationPath(entry, protocol) {
  return entry?.match(new RegExp(`^\\s*(?:${protocol.installationPathLabels.join("|")}):\\s*(.+)$`, "mu"))?.[1].trim();
}

/** Исключает provider-specific исходники и манифесты других Agent из проверки payload. */
function ignoredPayloadPaths(extension, agent, protocol) {
  return [
    ...protocol.sourceOnlyPaths,
    ...unselectedManifestPaths(extension, agent.id),
  ];
}

/** Reads the current native state once for connect and status. */
async function inspectExtension({ context, extension, nativeId, protocol }) {
  const output = await runNative(context, extension, [protocol.commands.group, protocol.commands.list]);
  return Object.freeze({ output, entry: findExtensionEntry(output, nativeId, protocol) });
}

/** Requires an installed record to be enabled in the requested scope. */
function assertEnabled({ entry, nativeId, protocol, scope, scopeMarkers }) {
  if (!entry) throw new Error(`AGENT_EXTENSION_STATUS_MISSING: ${nativeId}`);
  if (!entry.startsWith(protocol.statusHeading.enabled)) throw new Error(`AGENT_EXTENSION_STATUS_DISABLED: ${nativeId}`);
  if (scope !== undefined && !scopeMarkers[scope]?.some((marker) => entry.includes(marker))) {
    throw new Error(`AGENT_EXTENSION_STATUS_SCOPE_MISSING: ${nativeId} (${scope})`);
  }
}

/** Validates the native manifest and marketplace selector before mutation. */
async function validateExtension(extension, agent, protocol, { nativeId = extension.id } = {}) {
  const manifest = await readNativeManifest(path.join(extension.root, agent.manifest), extension.root);
  if (manifest.name !== nativeId) {
    throw new Error(`AGENT_EXTENSION_INVALID: ${agent.manifest} name '${manifest.name ?? ""}' не совпадает с native ID '${nativeId}'`);
  }
  const marketplace = await readNativeManifest(
    path.join(extension.root, protocol.marketplace.directory, protocol.marketplace.marketplace), extension.root,
  );
  const entries = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.filter((entry) => entry?.name === nativeId)
    : [];
  if (entries.length !== 1 || entries[0].source !== protocol.marketplace.marketplaceSource) {
    throw new Error(`AGENT_EXTENSION_INVALID: marketplace должен объявлять один ${nativeId} с source './'`);
  }
}

/** Explicitly refreshes a known installation without diagnosing it during connect. */
async function refreshIfRequested({ context, extension, nativeId, entry, protocol, refresh }) {
  if (!entry || refresh !== true) return;
  await runNative(context, extension, [protocol.commands.group, protocol.commands.update, nativeId]);
}

/** Verifies one Extension registration without auditing its installed files. */
async function statusExtension({ context, extension, nativeId, protocol, request, scopeMarkers }) {
  const scope = request.scope ?? protocol.defaultActivationScope;
  const state = await inspectExtension({ context, extension, nativeId, protocol });
  assertEnabled({ ...state, nativeId, protocol, scope, scopeMarkers });
  return state.output;
}

/** Performs the deep installed-payload audit reserved for Doctor. */
async function diagnoseExtension({ context, extension, nativeId, protocol, request, scopeMarkers }) {
  const scope = request.scope ?? protocol.defaultActivationScope;
  const state = await inspectExtension({ context, extension, nativeId, protocol });
  assertEnabled({ ...state, nativeId, protocol, scope, scopeMarkers });
  await assertInstalledPayload(extension, installationPath(state.entry, protocol), {
    ignoredPaths: ignoredPayloadPaths(extension, context.agent, protocol),
  });
  return state.output;
}

/** Installs or enables one Extension and verifies the resulting registration. */
async function connectExtension(input, protocol, scopeMarkers) {
  const { context, extension, nativeId, request, validateExtension: validate } = input;
  await validate(extension, context.agent, { nativeId });
  const scope = request.scope ?? protocol.defaultActivationScope;
  const state = await inspectExtension({ context, extension, nativeId, protocol });
  let args;
  if (state.entry) {
    await refreshIfRequested({ context, extension, nativeId, entry: state.entry, protocol, refresh: request.refresh });
    args = [protocol.commands.group, protocol.commands.enable, nativeId, "--scope", scope];
  } else {
    args = [protocol.commands.group, protocol.commands.install, `${extension.root}:${nativeId}`,
      "--scope", request.scope ?? context.agent.scope, "--consent"];
  }
  const output = await runNative(context, extension, args);
  await statusExtension({ context, extension, nativeId, protocol, request, scopeMarkers });
  return output;
}

/** Creates an adapter for one CLI implementing the Qwen Extension grammar. */
export function createExtensionCliLifecycle({ protocol, scopeMarkers } = AGENT_ADAPTER_CONFIG.qwen) {
  const validate = (extension, agent, options) => validateExtension(extension, agent, protocol, options);
  return createNativeExtensionAdapter({
    validateExtension: validate,
    operations: Object.freeze({
      connect: (input) => connectExtension(input, protocol, scopeMarkers),
      diagnose: (input) => diagnoseExtension({ ...input, protocol, scopeMarkers }),
      status: (input) => statusExtension({ ...input, protocol, scopeMarkers }),
      disconnect: ({ context, extension, nativeId, request }) => runNative(context, extension, [
        protocol.commands.group, protocol.commands.disable, nativeId, "--scope", request.scope ?? protocol.defaultActivationScope,
      ]),
      remove: ({ context, extension, nativeId }) => runNative(context, extension, [protocol.commands.group, protocol.commands.uninstall, nativeId]),
    }),
  });
}
