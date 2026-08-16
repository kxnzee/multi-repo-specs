/** @fileoverview Пользовательский сценарий команды `openspec-orch repository status`. */

import process from "node:process";

import { readRepositoryStatus } from "../../internal/repository/index.js";
import { findSpecRoot } from "../../internal/shared/store.js";

/**
 * Печатает читаемое состояние одного репозитория реестра.
 *
 * @param {import("../../internal/repository/types.js").RepositoryStatus} status Проверенный статус.
 * @returns {void}
 */
function printRepositoryStatus(status) {
  console.log(`${status.id} (${status.role}): ${status.state}`);
  if (status.path) console.log(`  path: ${status.path}`);
  if (status.connected) {
    console.log(`  branch: ${status.branch}${status.branchMatches ? "" : " (не совпадает с default_branch)"}`);
    console.log(`  remote: ${status.remoteMatches ? "совпадает" : "не совпадает с openspec-orch.yaml"}`);
    console.log(`  clean: ${status.clean ? "да" : "нет"}`);
  }
}

/**
 * Выполняет `openspec-orch repository status`: только чтение, без сети и исправлений.
 *
 * @param {{repositoryIds: string[]}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runRepositoryStatus(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const statuses = await readRepositoryStatus({
    storeRoot,
    repositoryIds: options.repositoryIds.length > 0 ? options.repositoryIds : undefined,
  });
  for (const status of statuses) printRepositoryStatus(status);
}
