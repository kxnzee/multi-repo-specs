/** @fileoverview Статичные имена Core-контрактов. */

export const CORE_FILES = Object.freeze({
  alternateOpenSpecConfig: "openspec/config.yml",
  orchestratorConfig: "openspec-orch.yaml",
  openSpecDirectory: "openspec",
  openSpecArchiveDirectory: "openspec/changes/archive",
  openSpecConfig: "openspec/config.yaml",
  openSpecProfileConfig: "openspec/config.json",
  openSpecSpecsDirectory: "openspec/specs",
  storeMetadata: ".openspec-store/store.yaml",
  templateDescriptor: "template.yaml",
});

export const CORE_SERVICE_PATHS = Object.freeze({
  cacheDirectory: ".openspec-orch/cache",
  coreState: ".openspec-orch/state.json",
  coreStateLock: ".openspec-orch/cache/locks/core-state.lock",
  directory: ".openspec-orch",
  lockDirectory: ".openspec-orch/cache/locks",
  projectConfigLock: ".openspec-orch/cache/locks/project-config.lock",
  pluginStateFile: "state.json",
  pluginsDirectory: ".openspec-orch/plugins",
});

export const CORE_CONTRACT_VERSIONS = Object.freeze({
  coreState: 1,
  pluginStorage: 1,
  project: 2,
  legacyProject: 1,
  store: 1,
});

export const CORE_PATTERNS = Object.freeze({
  gitRevision: /^[0-9a-f]{40}$/,
  gitRenameOrCopyState: /[RC]/,
  id: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  lineBreak: /\r?\n/,
  pluginId: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  repositoryArgument: /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/,
  semanticVersion: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  trailingSlashes: /\/+$/,
  windowsDrivePrefix: /^[A-Za-z]:/,
});
