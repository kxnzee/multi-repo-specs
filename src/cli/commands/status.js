/** @fileoverview Пользовательский сценарий команды `openspec-orch status`. */

import process from "node:process";

import { readChangeStatus } from "../../internal/cycle/status.js";
import { readCurrentRepository } from "../../internal/repository/current.js";
import { runCommand } from "../../internal/shared/command.js";
import { readStoreConfiguration, resolveCommandStoreRoot } from "../../internal/shared/store.js";

/**
 * Формирует стабильный agent-facing JSON без внутренних camelCase-полей.
 *
 * @param {object} result Status result.
 * @param {{id: string, role: "store" | "code", path: string} | null} currentRepository Repository вызова.
 * @returns {object} JSON payload.
 */
export function formatStatusJson(result, currentRepository) {
  return {
    change_id: result.changeId,
    cycle_id: result.cycle.cycleId,
    planning_revision: result.cycle.planningRevision,
    repositories: result.cycle.repositories,
    committed: result.committed,
    current_repository: currentRepository
      ? {
        repository_id: currentRepository.id,
        role: currentRepository.role,
        path: currentRepository.path,
        in_cycle: result.cycle.repositories.includes(currentRepository.id),
      }
      : null,
    results: result.repositories.map((repository) => ({
      repository_id: repository.repositoryId,
      status: repository.state,
      implementation_revision: repository.receipt?.implementation_revision ?? null,
      source: repository.receipt?.source ?? null,
      commit_available: repository.commitAvailable,
      head: repository.head,
      head_matches: repository.headMatches,
    })),
    snapshot: result.snapshot,
    verification: result.verification,
    next_action: result.nextAction,
  };
}

/**
 * Выполняет `openspec-orch status`: только чтение текущего Cycle из рабочей копии Store.
 *
 * @param {{changeId: string, json?: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runStatus(options) {
  const invocationRoot = process.cwd();
  const storeRoot = await resolveCommandStoreRoot(invocationRoot, runCommand);
  const [result, storeConfiguration] = await Promise.all([
    readChangeStatus({ storeRoot, changeId: options.changeId }),
    readStoreConfiguration(storeRoot),
  ]);
  const currentRepository = await readCurrentRepository({
    start: invocationRoot,
    storeRoot,
    metadata: storeConfiguration.metadata,
    project: storeConfiguration.project,
  });
  if (options.json) {
    console.log(JSON.stringify(formatStatusJson(result, currentRepository), null, 2));
    return;
  }
  console.log(`change_id: ${result.changeId}`);
  console.log(`cycle_id: ${result.cycle.cycleId}`);
  console.log(`planning_revision: ${result.cycle.planningRevision}`);
  console.log(`repositories: ${result.cycle.repositories.join(", ")}`);
  console.log(`committed: ${result.committed ? "да" : "нет"}`);
  if (currentRepository) {
    console.log(
      `current_repository: ${currentRepository.id} ` +
      `(in_cycle: ${result.cycle.repositories.includes(currentRepository.id) ? "да" : "нет"})`,
    );
  }
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
