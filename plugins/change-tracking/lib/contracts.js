/** @fileoverview Static Change Tracking contract values and validation schemas. */

import * as z from "zod";

export const CHANGE_TRACKING_CONTRACT = Object.freeze({
  cycleRecordVersion: 1,
  stateVersion: 1,
  resultReceiptVersion: 1,
  snapshotVersion: 1,
  verificationReceiptVersion: 1,
  snapshotHashVersion: 1,
  cyclePrefix: "cycle-",
  resultPrefix: "result-",
  snapshotPrefix: "snap-v1-",
  verificationPrefix: "verification-",
  cycleRecordsDirectory: ".openspec-orch/changes",
});

export const CHANGE_TRACKING_RESULT_STATUS = Object.freeze({
  blocked: "blocked",
  completed: "completed",
  failed: "failed",
});

export const CHANGE_TRACKING_RECEIPT_SOURCE = Object.freeze({
  agent: "agent",
  ci: "ci",
  human: "human",
});

export const CHANGE_TRACKING_VERIFICATION_RESULT = Object.freeze({
  fail: "fail",
  pass: "pass",
});

export const CHANGE_TRACKING_WRITE_STATUS = Object.freeze({
  cancelled: "cancelled",
  created: "created",
  replaced: "replaced",
});

export const CHANGE_TRACKING_REPOSITORY_STATE = Object.freeze({
  ...CHANGE_TRACKING_RESULT_STATUS,
  commitUnavailable: "commit_unavailable",
  disconnected: "disconnected",
  missing: "missing",
});

export const CHANGE_TRACKING_PATTERNS = Object.freeze({
  gitRevision: /^[0-9a-f]{40}$/,
  identifier: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
});

const UUID_V4_SCHEMA = z.uuidv4();

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.cycleRecordVersion),
  cycle_id: z.string().refine(
    (value) => value.startsWith(CHANGE_TRACKING_CONTRACT.cyclePrefix) &&
      UUID_V4_SCHEMA.safeParse(value.slice(CHANGE_TRACKING_CONTRACT.cyclePrefix.length)).success,
    "должен быть в формате cycle-<uuid-v4>",
  ),
  change_id: z.string().regex(
    CHANGE_TRACKING_PATTERNS.identifier,
    "должен быть в lowercase kebab-case",
  ),
  planning_revision: z.string().regex(
    CHANGE_TRACKING_PATTERNS.gitRevision,
    "должна быть полной lowercase SHA-1 ревизией",
  ),
  repositories: z.array(
    z.string().regex(
      CHANGE_TRACKING_PATTERNS.identifier,
      "repository-id должен быть в lowercase kebab-case",
    ),
  ).min(1),
  created_at: z.iso.datetime({ offset: false }),
});

/**
 * Validates a serialized Cycle Record v1.
 *
 * @param {unknown} value Parsed JSON value.
 * @returns {Readonly<Record<string, unknown>>} Validated record document.
 */
export function parseCycleRecordDocument(value) {
  const result = CYCLE_RECORD_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(
      `STATE_CORRUPTED: Некорректный Cycle Record: ${z.prettifyError(result.error)}`,
    );
  }
  return Object.freeze(result.data);
}

/** Validates a public Change ID before any repository access. */
export function assertChangeId(value) {
  if (typeof value !== "string" || !CHANGE_TRACKING_PATTERNS.identifier.test(value)) {
    throw new Error("change-id должен быть в lowercase kebab-case");
  }
}

/** Returns whether Git produced a full lowercase SHA-1 revision. */
export function isGitRevision(value) {
  return typeof value === "string" && CHANGE_TRACKING_PATTERNS.gitRevision.test(value);
}

/** Returns whether a value is one exact UUID v4 string. */
export function isUuidV4(value) {
  return UUID_V4_SCHEMA.safeParse(value).success;
}
