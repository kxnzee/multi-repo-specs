/** @fileoverview One domain model and storage adapter for all local Change Tracking state. */

import * as z from "zod";

import {
  CHANGE_TRACKING_CONTRACT,
  CHANGE_TRACKING_PATTERNS,
  CHANGE_TRACKING_RECEIPT_SOURCE,
  CHANGE_TRACKING_RESULT_STATUS,
  CHANGE_TRACKING_VERIFICATION_RESULT,
  isGitRevision,
  isUuidV4,
} from "./contracts.js";
import { SnapshotIdentity } from "./snapshot-identity.js";

const ID_SCHEMA = z.string().regex(CHANGE_TRACKING_PATTERNS.identifier);
const REVISION_SCHEMA = z.string().refine(isGitRevision);
const SOURCE_SCHEMA = z.enum(Object.values(CHANGE_TRACKING_RECEIPT_SOURCE));
const SNAPSHOT_ID_SCHEMA = z.string().regex(
  new RegExp(`^${CHANGE_TRACKING_CONTRACT.snapshotPrefix}[0-9a-f]{64}$`),
);

/** Builds a prefixed UUID v4 schema without introducing another domain type. */
function prefixedUuid(prefix) {
  return z.string().refine(
    (value) => value.startsWith(prefix) && isUuidV4(value.slice(prefix.length)),
  );
}

const CYCLE_ID_SCHEMA = prefixedUuid(CHANGE_TRACKING_CONTRACT.cyclePrefix);
const RESULT_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.resultReceiptVersion),
  receipt_id: prefixedUuid(CHANGE_TRACKING_CONTRACT.resultPrefix),
  cycle_id: CYCLE_ID_SCHEMA,
  repository_id: ID_SCHEMA,
  implementation_revision: REVISION_SCHEMA,
  status: z.enum(Object.values(CHANGE_TRACKING_RESULT_STATUS)),
  source: SOURCE_SCHEMA,
  note: z.string().min(1).optional(),
  created_at: z.iso.datetime({ offset: false }),
});
const SNAPSHOT_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.snapshotVersion),
  snapshot_id: SNAPSHOT_ID_SCHEMA,
  cycle_id: CYCLE_ID_SCHEMA,
  implementations: z.record(ID_SCHEMA, REVISION_SCHEMA)
    .refine((value) => Object.keys(value).length > 0),
  created_at: z.iso.datetime({ offset: false }),
}).superRefine((snapshot, context) => {
  const identity = new SnapshotIdentity(
    snapshot.cycle_id,
    Object.entries(snapshot.implementations).map(
      ([repository_id, implementation_revision]) => ({
        repository_id,
        implementation_revision,
      }),
    ),
  );
  if (snapshot.snapshot_id !== identity.value) {
    context.addIssue({
      code: "custom",
      path: ["snapshot_id"],
      message: "не соответствует содержимому Snapshot",
    });
  }
});
const VERIFICATION_RECEIPT_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.verificationReceiptVersion),
  receipt_id: prefixedUuid(CHANGE_TRACKING_CONTRACT.verificationPrefix),
  cycle_id: CYCLE_ID_SCHEMA,
  snapshot_id: SNAPSHOT_ID_SCHEMA,
  result: z.enum(Object.values(CHANGE_TRACKING_VERIFICATION_RESULT)),
  source: SOURCE_SCHEMA,
  note: z.string().min(1).optional(),
  created_at: z.iso.datetime({ offset: false }),
});
const STATE_SCHEMA = z.strictObject({
  contract_version: z.literal(CHANGE_TRACKING_CONTRACT.stateVersion),
  result_receipts: z.array(RESULT_RECEIPT_SCHEMA).default([]),
  result_receipt_history: z.array(RESULT_RECEIPT_SCHEMA).default([]),
  snapshots: z.array(SNAPSHOT_SCHEMA).default([]),
  verification_receipts: z.array(VERIFICATION_RECEIPT_SCHEMA).default([]),
  verification_receipt_history: z.array(VERIFICATION_RECEIPT_SCHEMA).default([]),
}).superRefine((state, context) => {
  const resultKeys = state.result_receipts.map(
    (receipt) => `${receipt.cycle_id}\0${receipt.repository_id}`,
  );
  const snapshotCycles = state.snapshots.map((snapshot) => snapshot.cycle_id);
  const verificationCycles = state.verification_receipts.map((receipt) => receipt.cycle_id);
  for (const [values, message] of [
    [resultKeys, "result_receipts содержит повторяющуюся пару cycle/repository"],
    [snapshotCycles, "snapshots содержит несколько текущих Snapshot одного Cycle"],
    [verificationCycles, "verification_receipts содержит несколько текущих Receipt одного Cycle"],
  ]) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message });
    }
  }
});

/** Recursively freezes one JSON-compatible value owned by the state aggregate. */
function freezeJson(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
    ));
  }
  return value;
}

/** Parses state and freezes its complete JSON value. */
function parseState(value) {
  const result = STATE_SCHEMA.safeParse(value ?? {
    contract_version: CHANGE_TRACKING_CONTRACT.stateVersion,
  });
  if (!result.success) {
    throw new Error(
      `STATE_CORRUPTED: Некорректный Change Tracking state: ${z.prettifyError(result.error)}`,
    );
  }
  return freezeJson(result.data);
}

/** Immutable aggregate for current receipts, histories and snapshots. */
export class ChangeTrackingState {
  #document;

  /** @param {unknown} [document] Persisted plugin data or undefined for empty state. */
  constructor(document) {
    this.#document = parseState(document);
    Object.freeze(this);
  }

  result(cycleId, repositoryId) {
    return this.#document.result_receipts.find((receipt) => (
      receipt.cycle_id === cycleId && receipt.repository_id === repositoryId
    )) ?? null;
  }

  snapshot(cycleId) {
    return this.#document.snapshots.find((snapshot) => snapshot.cycle_id === cycleId) ?? null;
  }

  verification(cycleId) {
    return this.#document.verification_receipts.find(
      (receipt) => receipt.cycle_id === cycleId,
    ) ?? null;
  }

  resultsFor(cycleId) {
    return Object.freeze(
      this.#document.result_receipts.filter((receipt) => receipt.cycle_id === cycleId),
    );
  }

  recordResult(receipt) {
    const checked = RESULT_RECEIPT_SCHEMA.parse(receipt);
    const existing = this.result(checked.cycle_id, checked.repository_id);
    return this.#replace({
      result_receipts: [
        ...this.#document.result_receipts.filter((candidate) => (
          candidate.cycle_id !== checked.cycle_id ||
          candidate.repository_id !== checked.repository_id
        )),
        checked,
      ],
      result_receipt_history: existing
        ? [...this.#document.result_receipt_history, existing]
        : this.#document.result_receipt_history,
    });
  }

  recordSnapshot(snapshot) {
    const checked = SNAPSHOT_SCHEMA.parse(snapshot);
    return this.#replace({
      snapshots: [
        ...this.#document.snapshots.filter(
          (candidate) => candidate.cycle_id !== checked.cycle_id,
        ),
        checked,
      ],
    });
  }

  recordVerification(receipt) {
    const checked = VERIFICATION_RECEIPT_SCHEMA.parse(receipt);
    const existing = this.verification(checked.cycle_id);
    return this.#replace({
      verification_receipts: [
        ...this.#document.verification_receipts.filter(
          (candidate) => candidate.cycle_id !== checked.cycle_id,
        ),
        checked,
      ],
      verification_receipt_history: existing
        ? [...this.#document.verification_receipt_history, existing]
        : this.#document.verification_receipt_history,
    });
  }

  toDocument() {
    return this.#document;
  }

  #replace(changes) {
    return new ChangeTrackingState({ ...this.#document, ...changes });
  }
}

/** Thin adapter from the domain aggregate to PluginContext.storage. */
export class ChangeTrackingStore {
  #storage;

  /** @param {{read: Function, update: Function}} storage Public Plugin storage facade. */
  constructor(storage) {
    if (!storage || typeof storage.read !== "function" || typeof storage.update !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: требуется Storage facade");
    }
    this.#storage = storage;
    Object.freeze(this);
  }

  async read() {
    return new ChangeTrackingState(await this.#storage.read());
  }

  async update(operation) {
    if (typeof operation !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: update operation должна быть функцией");
    }
    const document = await this.#storage.update(async (current) => {
      const next = await operation(new ChangeTrackingState(current));
      if (!(next instanceof ChangeTrackingState)) {
        throw new Error("CHANGE_TRACKING_INVALID: update должен вернуть ChangeTrackingState");
      }
      return next.toDocument();
    });
    return new ChangeTrackingState(document);
  }
}
