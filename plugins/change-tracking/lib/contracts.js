/** @fileoverview Minimal persisted contract for task implementation attempts. */

export const CHANGE_TRACKING_CONTRACT = Object.freeze({
  implementationMapVersion: 1,
  implementationMapFile: "implementation-map.yaml",
  attemptStorageVersion: 1,
});

export const CHANGE_TRACKING_PATTERNS = Object.freeze({
  gitRevision: /^[0-9a-f]{40}$/,
  identifier: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
});

/** Validates a public Change ID before repository access. */
export function assertChangeId(value) {
  if (typeof value !== "string" || !CHANGE_TRACKING_PATTERNS.identifier.test(value)) {
    throw new Error("change-id должен быть в lowercase kebab-case");
  }
}

/** Returns whether Git produced a full lowercase SHA-1 revision. */
export function isGitRevision(value) {
  return typeof value === "string" && CHANGE_TRACKING_PATTERNS.gitRevision.test(value);
}
