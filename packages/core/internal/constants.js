/** @fileoverview Статичные имена Core-контрактов. */

export const CORE_FILES = Object.freeze({
  orchestratorConfig: "openspec-orch.yaml",
  openSpecDirectory: "openspec",
  storeMetadata: ".openspec-store/store.yaml",
});

export const CORE_SERVICE_PATHS = Object.freeze({
  cacheDirectory: ".openspec-orch/cache",
  directory: ".openspec-orch",
  lockDirectory: ".openspec-orch/cache/locks",
  pluginStateFile: "state.json",
  pluginsDirectory: ".openspec-orch/plugins",
});

export const CORE_CONTRACT_VERSIONS = Object.freeze({
  pluginStorage: 1,
  project: 2,
  legacyProject: 1,
  store: 1,
});

export const CORE_PATTERNS = Object.freeze({
  gitRenameOrCopyState: /[RC]/,
  id: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  lineBreak: /\r?\n/,
  pluginId: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  windowsDrivePrefix: /^[A-Za-z]:/,
});
