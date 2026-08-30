/** @fileoverview Static Change Tracking contract values and validation schemas. */

import * as z from "zod";

export const CHANGE_TRACKING_CONTRACT = Object.freeze({
  cycleRecordVersion: 1,
  resultReceiptVersion: 1,
  snapshotVersion: 1,
  verificationReceiptVersion: 1,
  snapshotHashVersion: 1,
  cyclePrefix: "cycle-",
  resultPrefix: "result-",
  snapshotPrefix: "snap-v1-",
  verificationPrefix: "verification-",
  trackingDirectory: "tracking/cycles",
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

export const CHANGE_TRACKING_PATTERNS = Object.freeze({
  gitRevision: /^[0-9a-f]{40}$/,
  identifier: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
});

const UUID_V4_SCHEMA = z.uuidv4();

/** Builds a prefixed UUID v4 schema for persisted evidence identities. */
function prefixedUuid(prefix, message) {
  return z.string().refine(
    (value) => value.startsWith(prefix) &&
      UUID_V4_SCHEMA.safeParse(value.slice(prefix.length)).success,
    message,
  );
}

const IDENTIFIER_SCHEMA = z.string().regex(CHANGE_TRACKING_PATTERNS.identifier);
const REVISION_SCHEMA = z.string().regex(CHANGE_TRACKING_PATTERNS.gitRevision);
const SOURCE_SCHEMA = z.enum(Object.values(CHANGE_TRACKING_RECEIPT_SOURCE));
const CYCLE_ID_SCHEMA = prefixedUuid(
  CHANGE_TRACKING_CONTRACT.cyclePrefix,
  "должен быть в формате cycle-<uuid-v4>",
);
const SNAPSHOT_ID_SCHEMA = z.string().regex(
  new RegExp(`^${CHANGE_TRACKING_CONTRACT.snapshotPrefix}[0-9a-f]{64}$`),
);

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.cycleRecordVersion),
  cycle_id: CYCLE_ID_SCHEMA,
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

const RESULT_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.resultReceiptVersion),
  receipt_id: prefixedUuid(CHANGE_TRACKING_CONTRACT.resultPrefix),
  cycle_id: CYCLE_ID_SCHEMA,
  repository_id: IDENTIFIER_SCHEMA,
  implementation_revision: REVISION_SCHEMA,
  source: SOURCE_SCHEMA,
  supersedes: prefixedUuid(CHANGE_TRACKING_CONTRACT.resultPrefix).nullable(),
  created_at: z.iso.datetime({ offset: false }),
});

const VERIFICATION_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.verificationReceiptVersion),
  receipt_id: prefixedUuid(CHANGE_TRACKING_CONTRACT.verificationPrefix),
  cycle_id: CYCLE_ID_SCHEMA,
  snapshot_id: SNAPSHOT_ID_SCHEMA,
  result: z.enum(Object.values(CHANGE_TRACKING_VERIFICATION_RESULT)),
  source: SOURCE_SCHEMA,
  supersedes: prefixedUuid(CHANGE_TRACKING_CONTRACT.verificationPrefix).nullable(),
  note: z.string().min(1).optional(),
  created_at: z.iso.datetime({ offset: false }),
});

/** Validates and freezes one strict persisted document. */
function parseDocument(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`STATE_CORRUPTED: Некорректный ${label}: ${z.prettifyError(result.error)}`);
  }
  return Object.freeze(result.data);
}

/**
 * Validates a serialized Cycle Record v1.
 *
 * @param {unknown} value Parsed JSON value.
 * @returns {Readonly<Record<string, unknown>>} Validated record document.
 */
export function parseCycleRecordDocument(value) {
  return parseDocument(CYCLE_RECORD_SCHEMA, value, "Cycle Record");
}

/** Validates one strict Result Receipt v1 document. */
export function parseResultReceiptDocument(value) {
  return parseDocument(RESULT_RECEIPT_SCHEMA, value, "Result Receipt");
}

/** Validates one strict Verification Receipt v1 document. */
export function parseVerificationReceiptDocument(value) {
  return parseDocument(VERIFICATION_RECEIPT_SCHEMA, value, "Verification Receipt");
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
