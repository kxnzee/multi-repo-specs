/** @fileoverview Static Change Tracking contract values and validation schemas. */

import * as z from "zod";

export const CHANGE_TRACKING_CONTRACT = Object.freeze({
  cycleRecordVersion: 1,
  snapshotVersion: 1,
  snapshotHashVersion: 1,
  cyclePrefix: "cycle-",
  snapshotPrefix: "snap-v1-",
});

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const UUID_V4_SCHEMA = z.uuidv4();

const CYCLE_RECORD_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.cycleRecordVersion),
  cycle_id: z.string().refine(
    (value) => value.startsWith(CHANGE_TRACKING_CONTRACT.cyclePrefix) &&
      UUID_V4_SCHEMA.safeParse(value.slice(CHANGE_TRACKING_CONTRACT.cyclePrefix.length)).success,
    "должен быть в формате cycle-<uuid-v4>",
  ),
  change_id: z.string().regex(IDENTIFIER_PATTERN, "должен быть в lowercase kebab-case"),
  planning_revision: z.string().regex(
    GIT_REVISION_PATTERN,
    "должна быть полной lowercase SHA-1 ревизией",
  ),
  repositories: z.array(
    z.string().regex(IDENTIFIER_PATTERN, "repository-id должен быть в lowercase kebab-case"),
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
