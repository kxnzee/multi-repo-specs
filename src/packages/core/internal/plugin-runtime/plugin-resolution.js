/** @fileoverview Shared isolation boundary for optional Plugin resolution failures. */

const RECOVERABLE_PLUGIN_RESOLUTION = /^(?:BUNDLED_PLUGIN_INVALID|PACKAGE_RUNTIME_UNAVAILABLE|PACKAGE_SUPPLY_INVALID|PLUGIN_CONTRACT_INVALID|PLUGIN_LOAD_INVALID|PLUGIN_MANAGER_INVALID|PLUGIN_RUNTIME_UNAVAILABLE):/u;

/** Keeps optional Plugin failures isolated without swallowing unrelated Core defects. */
export function isRecoverablePluginResolution(error) {
  return ["PACKAGE_RUNTIME_UNAVAILABLE", "PLUGIN_RUNTIME_UNAVAILABLE"].includes(error?.code) ||
    RECOVERABLE_PLUGIN_RESOLUTION.test(error?.message ?? "");
}
