/** @fileoverview Запись Result Receipt для одного Code Repository текущего Cycle. */

import { randomUUID } from "node:crypto";

import { assertCycleCommitted, readCurrentCycle } from "../cycle/current.js";
import { inspectImplementationRevision } from "../repository/revision.js";
import { runCommand } from "../shared/command.js";
import { isGitRevision } from "../shared/schema.js";
import { readState, withStateLock, writeState } from "../state/index.js";
import { RESULT_RECEIPT_SCHEMA } from "../state/schema.js";

/**
 * Создаёт и после подтверждения сохраняет Result Receipt.
 *
 * @param {object} options Параметры Receipt.
 * @returns {Promise<object>} Результат записи.
 */
export async function recordAssignment(options) {
  const {
    storeRoot,
    changeId,
    repositoryId,
    implementationRevision,
    status,
    source,
    note,
    confirm,
    commandRunner = runCommand,
  } = options;
  if (!isGitRevision(implementationRevision)) {
    throw new Error("COMMIT_NOT_FOUND: --commit должен быть полной lowercase SHA-1 ревизией");
  }
  const context = await readCurrentCycle({ storeRoot, changeId, commandRunner });
  assertCycleCommitted(context);
  if (!context.cycle.repositories.includes(repositoryId)) {
    throw new Error(`REPO_UNKNOWN: repository-id '${repositoryId}' не входит в текущий Cycle`);
  }
  const implementation = await inspectImplementationRevision(
    context,
    repositoryId,
    implementationRevision,
    commandRunner,
  );
  if (!implementation.available) {
    throw new Error(`COMMIT_NOT_FOUND: commit ${implementationRevision} не существует в ${repositoryId}`);
  }

  const state = await readState(storeRoot);
  const existing = state.result_receipts.find(
    (receipt) => receipt.cycle_id === context.cycle.cycleId && receipt.repository_id === repositoryId,
  );
  const receipt = RESULT_RECEIPT_SCHEMA.parse({
    contract_version: 1,
    receipt_id: `result-${randomUUID()}`,
    cycle_id: context.cycle.cycleId,
    repository_id: repositoryId,
    implementation_revision: implementationRevision,
    status,
    source,
    ...(note ? { note } : {}),
    created_at: new Date().toISOString(),
  });
  const proceed = await confirm({
    receipt,
    existing,
    repositoryRoot: implementation.repositoryRoot,
    head: implementation.head,
  });
  if (!proceed) return { status: "cancelled" };

  await withStateLock(storeRoot, async () => {
    const currentContext = await readCurrentCycle({ storeRoot, changeId, commandRunner });
    assertCycleCommitted(currentContext);
    if (currentContext.cycle.cycleId !== context.cycle.cycleId) {
      throw new Error("CYCLE_MISMATCH: текущий Cycle изменился после preview; повторите команду");
    }
    const currentState = await readState(storeRoot);
    const currentExisting = currentState.result_receipts.find(
      (candidate) => candidate.cycle_id === context.cycle.cycleId && candidate.repository_id === repositoryId,
    );
    if ((currentExisting?.receipt_id ?? null) !== (existing?.receipt_id ?? null)) {
      throw new Error("CYCLE_MISMATCH: текущий Result Receipt изменился после preview; повторите команду");
    }

    const next = {
      ...currentState,
      result_receipts: [
        ...currentState.result_receipts.filter(
          (candidate) => candidate.cycle_id !== context.cycle.cycleId || candidate.repository_id !== repositoryId,
        ),
        receipt,
      ],
      result_receipt_history: existing
        ? [...currentState.result_receipt_history, existing]
        : currentState.result_receipt_history,
    };
    await writeState(storeRoot, next);
  });
  return {
    status: existing ? "replaced" : "created",
    receipt,
    replaced: existing ?? null,
    headMatches: implementation.head === implementationRevision,
  };
}
