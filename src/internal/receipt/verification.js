/** @fileoverview Запись Verification Receipt для текущего Snapshot. */

import { randomUUID } from "node:crypto";

import { CONTRACT_VERSIONS, IDENTIFIER_PREFIXES } from "../config/constants.js";
import { assertCycleCommitted, readCurrentCycle } from "../cycle/current.js";
import { runCommand } from "../shared/command.js";
import { computeSnapshotId, currentImplementations } from "../snapshot/index.js";
import { readState, withStateLock, writeState } from "../state/index.js";
import { VERIFICATION_RECEIPT_SCHEMA } from "../state/schema.js";

/**
 * Создаёт и после подтверждения сохраняет Verification Receipt.
 *
 * @param {object} options Параметры Receipt.
 * @param {string} options.storeRoot Корень Store.
 * @param {string} options.changeId Change ID.
 * @param {"pass" | "fail"} options.result Результат внешней проверки.
 * @param {"human" | "agent" | "ci"} options.source Источник результата.
 * @param {string} [options.note] Необязательная заметка.
 * @param {(preview: object) => Promise<boolean>} options.confirm Подтверждение записи.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<object>} Результат записи.
 */
export async function recordVerification({
  storeRoot,
  changeId,
  result,
  source,
  note,
  confirm,
  commandRunner = runCommand,
}) {
  const context = await readCurrentCycle({ storeRoot, changeId, commandRunner });
  assertCycleCommitted(context);
  const state = await readState(storeRoot);
  let expectedSnapshotId;
  try {
    expectedSnapshotId = computeSnapshotId(
      context.cycle.cycleId,
      currentImplementations(context.cycle, state),
    );
  } catch (error) {
    throw new Error(`SNAPSHOT_MISMATCH: ${error.message}`);
  }
  const snapshot = state.snapshots.find(({ cycle_id: cycleId }) => cycleId === context.cycle.cycleId);
  if (!snapshot || snapshot.snapshot_id !== expectedSnapshotId) {
    throw new Error("SNAPSHOT_MISMATCH: сначала вызовите verify для текущего набора Result Receipts");
  }
  const existing = state.verification_receipts.find(
    ({ cycle_id: cycleId }) => cycleId === context.cycle.cycleId,
  );
  const receipt = VERIFICATION_RECEIPT_SCHEMA.parse({
    contract_version: CONTRACT_VERSIONS.verificationReceipt,
    receipt_id: `${IDENTIFIER_PREFIXES.verification}${randomUUID()}`,
    cycle_id: context.cycle.cycleId,
    snapshot_id: snapshot.snapshot_id,
    result,
    source,
    ...(note ? { note } : {}),
    created_at: new Date().toISOString(),
  });
  const proceed = await confirm({ receipt, existing, snapshot });
  if (!proceed) return { status: "cancelled" };

  await withStateLock(storeRoot, async () => {
    const currentContext = await readCurrentCycle({ storeRoot, changeId, commandRunner });
    assertCycleCommitted(currentContext);
    if (currentContext.cycle.cycleId !== context.cycle.cycleId) {
      throw new Error("SNAPSHOT_MISMATCH: текущий Cycle изменился после preview; повторите команду");
    }
    const currentState = await readState(storeRoot);
    let currentSnapshotId;
    try {
      currentSnapshotId = computeSnapshotId(
        currentContext.cycle.cycleId,
        currentImplementations(currentContext.cycle, currentState),
      );
    } catch (error) {
      throw new Error(`SNAPSHOT_MISMATCH: ${error.message}`);
    }
    const currentSnapshot = currentState.snapshots.find(
      ({ cycle_id: cycleId }) => cycleId === currentContext.cycle.cycleId,
    );
    const currentExisting = currentState.verification_receipts.find(
      ({ cycle_id: cycleId }) => cycleId === currentContext.cycle.cycleId,
    );
    if (
      !currentSnapshot ||
      currentSnapshot.snapshot_id !== currentSnapshotId ||
      currentSnapshotId !== receipt.snapshot_id ||
      (currentExisting?.receipt_id ?? null) !== (existing?.receipt_id ?? null)
    ) {
      throw new Error("SNAPSHOT_MISMATCH: текущий Snapshot изменился после preview; повторите команду");
    }

    await writeState(storeRoot, {
      ...currentState,
      verification_receipts: [
        ...currentState.verification_receipts.filter(
          ({ cycle_id: cycleId }) => cycleId !== context.cycle.cycleId,
        ),
        receipt,
      ],
      verification_receipt_history: existing
        ? [...currentState.verification_receipt_history, existing]
        : currentState.verification_receipt_history,
    });
  });
  return {
    status: existing ? "replaced" : "created",
    receipt,
    replaced: existing ?? null,
  };
}
