/** @fileoverview Единая точка статических контрактов и служебных путей Core. */

import path from "node:path";

export const CONTRACT_VERSIONS = Object.freeze({
  orchestratorConfig: 2,
  legacyOrchestratorConfig: 1,
  storeMetadata: 1,
  cycleRecord: 1,
  state: 1,
  resultReceipt: 1,
  snapshot: 1,
  verificationReceipt: 1,
  snapshotHash: 1,
});

export const IDENTIFIER_PREFIXES = Object.freeze({
  cycle: "cycle-",
  result: "result-",
  verification: "verification-",
  snapshot: `snap-v${CONTRACT_VERSIONS.snapshotHash}-`,
});

export const CONTRACT_PATTERNS = Object.freeze({
  id: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  gitRevision: /^[0-9a-f]{40}$/,
  semanticVersion: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  exactSemanticVersion: /^\d+\.\d+\.\d+$/,
  executableName: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  repositoryArgument: /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/,
  pointer: /^store: ([a-z0-9]+(?:-[a-z0-9]+)*)\n$/,
  windowsDrivePrefix: /^[A-Za-z]:/,
  trailingSlashes: /\/+$/,
  gitRenameOrCopyState: /[RC]/,
  lineBreak: /\r?\n/,
  whitespace: /\s+/,
  snapshotId: new RegExp(`^${IDENTIFIER_PREFIXES.snapshot}[0-9a-f]{64}$`),
});

export const DESCRIPTOR_FILES = Object.freeze({
  plugin: "plugin.yaml",
  template: "template.yaml",
});

export const SERVICE_PATHS = Object.freeze({
  gitDirectory: ".git",
  orchestratorConfig: "openspec-orch.yaml",
  storeMetadata: path.join(".openspec-store", "store.yaml"),
  openSpecDirectory: "openspec",
  openSpecConfig: path.join("openspec", "config.yaml"),
  alternateOpenSpecConfig: path.join("openspec", "config.yml"),
  openSpecProfileConfig: path.join("openspec", "config.json"),
  openSpecSpecs: path.join("openspec", "specs"),
  openSpecChangeArchive: path.join("openspec", "changes", "archive"),
  stateDirectory: ".openspec-orch",
  state: path.join(".openspec-orch", "state.json"),
  stateCacheDirectory: path.join(".openspec-orch", "cache"),
  stateLock: path.join(".openspec-orch", "cache", "state.lock"),
  cycleRecords: path.join(".openspec-orch", "changes"),
  pluginCache: path.join(".openspec-orch", "cache", "plugins"),
});
