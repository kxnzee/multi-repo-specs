/** @fileoverview Строгие схемы локального состояния OpenSpec Orchestrator. */

import * as z from "zod";

import {
  CONTRACT_PATTERNS,
  CONTRACT_VERSIONS,
  IDENTIFIER_PREFIXES,
  SERVICE_PATHS,
} from "../config/constants.js";
import { isGitRevision, isRepositoryId } from "../shared/schema.js";
import { computeSnapshotId } from "../snapshot/identity.js";

const UUID_V4_SCHEMA = z.uuidv4();
const CYCLE_ID_SCHEMA = z.string().refine(
  (value) => value.startsWith(IDENTIFIER_PREFIXES.cycle) &&
    UUID_V4_SCHEMA.safeParse(value.slice(IDENTIFIER_PREFIXES.cycle.length)).success,
  "должен быть в формате cycle-<uuid-v4>",
);
const RESULT_ID_SCHEMA = z.string().refine(
  (value) => value.startsWith(IDENTIFIER_PREFIXES.result) &&
    UUID_V4_SCHEMA.safeParse(value.slice(IDENTIFIER_PREFIXES.result.length)).success,
  "должен быть в формате result-<uuid-v4>",
);
const VERIFICATION_ID_SCHEMA = z.string().refine(
  (value) => value.startsWith(IDENTIFIER_PREFIXES.verification) &&
    UUID_V4_SCHEMA.safeParse(value.slice(IDENTIFIER_PREFIXES.verification.length)).success,
  "должен быть в формате verification-<uuid-v4>",
);
const SNAPSHOT_ID_SCHEMA = z.string().regex(
  CONTRACT_PATTERNS.snapshotId,
  `должен быть ${IDENTIFIER_PREFIXES.snapshot}<sha256>`,
);
const REVISION_SCHEMA = z.string().refine(isGitRevision, "должна быть полной lowercase SHA-1 ревизией");
const REPOSITORY_ID_SCHEMA = z.string().refine(isRepositoryId, "должен быть в lowercase kebab-case");
const SOURCE_SCHEMA = z.enum(["human", "agent", "ci"]);

export const RESULT_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CONTRACT_VERSIONS.resultReceipt),
  receipt_id: RESULT_ID_SCHEMA,
  cycle_id: CYCLE_ID_SCHEMA,
  repository_id: REPOSITORY_ID_SCHEMA,
  implementation_revision: REVISION_SCHEMA,
  status: z.enum(["completed", "failed", "blocked"]),
  source: SOURCE_SCHEMA,
  note: z.string().min(1).optional(),
  created_at: z.iso.datetime({ offset: false }),
});

export const SNAPSHOT_SCHEMA = z.strictObject({
  contract_version: z.literal(CONTRACT_VERSIONS.snapshot),
  snapshot_id: SNAPSHOT_ID_SCHEMA,
  cycle_id: CYCLE_ID_SCHEMA,
  implementations: z.record(REPOSITORY_ID_SCHEMA, REVISION_SCHEMA)
    .refine((value) => Object.keys(value).length > 0, "должен содержать минимум один repository-id"),
  created_at: z.iso.datetime({ offset: false }),
}).superRefine((snapshot, context) => {
  const expectedId = computeSnapshotId(
    snapshot.cycle_id,
    Object.entries(snapshot.implementations).map(([repository_id, implementation_revision]) => ({
      repository_id,
      implementation_revision,
    })),
  );
  if (snapshot.snapshot_id !== expectedId) {
    context.addIssue({ code: "custom", path: ["snapshot_id"], message: "не соответствует содержимому Snapshot" });
  }
});

export const VERIFICATION_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CONTRACT_VERSIONS.verificationReceipt),
  receipt_id: VERIFICATION_ID_SCHEMA,
  cycle_id: CYCLE_ID_SCHEMA,
  snapshot_id: SNAPSHOT_ID_SCHEMA,
  result: z.enum(["pass", "fail"]),
  source: SOURCE_SCHEMA,
  note: z.string().min(1).optional(),
  created_at: z.iso.datetime({ offset: false }),
});

const STATE_SCHEMA = z.strictObject({
  contract_version: z.literal(CONTRACT_VERSIONS.state),
  workspace: z.string().nullable().default(null),
  result_receipts: z.array(RESULT_RECEIPT_SCHEMA).default([]),
  result_receipt_history: z.array(RESULT_RECEIPT_SCHEMA).default([]),
  snapshots: z.array(SNAPSHOT_SCHEMA).default([]),
  verification_receipts: z.array(VERIFICATION_RECEIPT_SCHEMA).default([]),
  verification_receipt_history: z.array(VERIFICATION_RECEIPT_SCHEMA).default([]),
}).superRefine((state, context) => {
  const resultKeys = state.result_receipts.map(
    (receipt) => `${receipt.cycle_id}\0${receipt.repository_id}`,
  );
  if (new Set(resultKeys).size !== resultKeys.length) {
    context.addIssue({ code: "custom", message: "result_receipts содержит повторяющуюся текущую пару cycle/repository" });
  }
  const snapshotCycles = state.snapshots.map(({ cycle_id: cycleId }) => cycleId);
  if (new Set(snapshotCycles).size !== snapshotCycles.length) {
    context.addIssue({ code: "custom", message: "snapshots содержит несколько текущих Snapshot одного Cycle" });
  }
  const verificationCycles = state.verification_receipts.map(({ cycle_id: cycleId }) => cycleId);
  if (new Set(verificationCycles).size !== verificationCycles.length) {
    context.addIssue({ code: "custom", message: "verification_receipts содержит несколько текущих Receipt одного Cycle" });
  }
});

/**
 * Проверяет локальный state v1 и заполняет отсутствующие пустые секции MVP-0.
 *
 * @param {unknown} value Разобранный JSON.
 * @returns {z.infer<typeof STATE_SCHEMA>} Проверенное состояние.
 */
export function parseStateSchema(value) {
  const result = STATE_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(
      `STATE_CORRUPTED: Некорректный ${SERVICE_PATHS.state}: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
