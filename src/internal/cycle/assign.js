/** @fileoverview Оркестрация `openspec-orch assign`: preview, подтверждение, запись Cycle Record. */

import { runCommand } from "../shared/command.js";
import { assertNoGitOperation } from "../shared/git.js";
import { createGitClient } from "../shared/git-client.js";
import { assertChangeId, isGitRevision } from "../shared/schema.js";
import { readStoreConfiguration } from "../shared/store.js";
import {
  createCycleRecord,
  cycleRecordPath,
  cycleRecordRelativePath,
  readCycleRecord,
  writeCycleRecord,
} from "./record.js";

/**
 * Сравнивает состав репозиториев без учёта порядка.
 *
 * @param {string[]} left Первый список repository-id.
 * @param {string[]} right Второй список repository-id.
 * @returns {boolean} Совпадает ли состав.
 */
function sameRepositorySet(left, right) {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

/**
 * Оркестрирует `assign`: перечитывает реестр, требует чистый Store, показывает preview,
 * запрашивает подтверждение и атомарно записывает Cycle Record. Core не создаёт Git commit.
 *
 * @param {object} options Параметры.
 * @param {string} options.storeRoot Канонический путь рабочей копии Store.
 * @param {string} options.changeId change-id, переданный пользователем.
 * @param {string[]} options.repositoryIds Запрошенные repository-id.
 * @param {(preview: import("./types.js").AssignPreview) => Promise<boolean>} options.confirm Интерактивное подтверждение.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<import("./types.js").AssignResult>} Итог операции.
 */
export async function assignCycle({
  storeRoot,
  changeId,
  repositoryIds,
  confirm,
  commandRunner = runCommand,
}) {
  assertChangeId(changeId);
  if (repositoryIds.length === 0) throw new Error("assign требует минимум один --repo");
  const uniqueRepositoryIds = [...new Set(repositoryIds)];
  if (uniqueRepositoryIds.length !== repositoryIds.length) {
    throw new Error("REPO_UNKNOWN: один и тот же --repo передан дважды");
  }

  const { config } = await readStoreConfiguration(storeRoot);
  const knownIds = new Set(config.repositories.map(({ id }) => id));
  for (const id of uniqueRepositoryIds) {
    if (!knownIds.has(id)) {
      throw new Error(`REPO_UNKNOWN: repository-id '${id}' отсутствует в openspec-orch.yaml`);
    }
  }

  await assertNoGitOperation(storeRoot, commandRunner);
  const git = createGitClient(storeRoot, commandRunner);
  const recordRelativePath = cycleRecordRelativePath(changeId);
  const changedPaths = await git.statusPaths();
  if (changedPaths.some((changedPath) => changedPath !== recordRelativePath)) {
    throw new Error(`STORE_DIRTY: рабочее дерево Store должно быть чистым (кроме ${recordRelativePath})`);
  }
  const planningRevision = await git.revision();
  if (!isGitRevision(planningRevision)) {
    throw new Error("Git вернул некорректную ревизию рабочей копии Store");
  }

  const recordPath = cycleRecordPath(storeRoot, changeId);
  const existing = await readCycleRecord(storeRoot, changeId);
  if (existing) {
    const unchanged = existing.planningRevision === planningRevision &&
      sameRepositorySet(existing.repositories, uniqueRepositoryIds);
    if (unchanged) return { status: "unchanged", cycle: existing, path: recordPath };

    const proceed = await confirm({
      kind: "replace",
      changeId,
      path: recordPath,
      existing,
      planningRevision,
      repositories: uniqueRepositoryIds,
    });
    if (!proceed) return { status: "cancelled", path: recordPath };
  } else {
    const proceed = await confirm({
      kind: "create",
      changeId,
      path: recordPath,
      planningRevision,
      repositories: uniqueRepositoryIds,
    });
    if (!proceed) return { status: "cancelled", path: recordPath };
  }

  const record = createCycleRecord({ changeId, planningRevision, repositories: uniqueRepositoryIds });
  await writeCycleRecord(storeRoot, record);
  return { status: existing ? "replaced" : "created", cycle: record, path: recordPath };
}
