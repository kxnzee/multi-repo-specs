/** @fileoverview Пользовательский сценарий команды `openspec-orch repository status`. */

import process from "node:process";

import { SERVICE_PATHS } from "../../internal/config/constants.js";
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
    const remoteState = status.remoteMatches
      ? "совпадает"
      : `не совпадает с ${SERVICE_PATHS.orchestratorConfig}`;
    console.log(`  remote: ${remoteState}`);
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
