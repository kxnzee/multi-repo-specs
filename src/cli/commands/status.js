/** @fileoverview Пользовательский сценарий команды `openspec-orch status`. */

import process from "node:process";

import { readChangeStatus } from "../../internal/cycle/status.js";
import { findSpecRoot } from "../../internal/shared/store.js";

/**
 * Выполняет `openspec-orch status`: только чтение текущего Cycle из рабочей копии Store.
 *
 * @param {{changeId: string}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runStatus(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const result = await readChangeStatus({ storeRoot, changeId: options.changeId });
  console.log(`change_id: ${result.changeId}`);
  console.log(`cycle_id: ${result.cycle.cycleId}`);
  console.log(`planning_revision: ${result.cycle.planningRevision}`);
  console.log(`repositories: ${result.cycle.repositories.join(", ")}`);
  console.log(`committed: ${result.committed ? "да" : "нет"}`);
  if (!result.committed) console.log("Предупреждение: Cycle Record ещё не закоммичен.");
  console.log("Результаты:");
  for (const repository of result.repositories) {
    if (!repository.receipt) {
      console.log(`  ${repository.repositoryId}: missing`);
      continue;
    }
    console.log(
      `  ${repository.repositoryId}: ${repository.state} @ ${repository.receipt.implementation_revision} ` +
      `(source: ${repository.receipt.source})`,
    );
    if (repository.headMatches === false) {
      console.log(`    info: HEAD checkout отличается (${repository.head}); Receipt сохраняет точный SHA.`);
    }
  }
  if (result.snapshot) {
    console.log(`snapshot_id: ${result.snapshot.snapshot_id} (current: ${result.snapshot.current ? "да" : "нет"})`);
  }
  if (result.verification) {
    console.log(
      `verification: ${result.verification.result} ` +
      `(source: ${result.verification.source}, current: ${result.verification.current ? "да" : "нет"})`,
    );
  }
  console.log(`следующее действие: ${result.nextAction}`);
}
