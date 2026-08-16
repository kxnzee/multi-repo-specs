/** @fileoverview Чтение локальной доступности точной ревизии Code Repository. */

import path from "node:path";

import { lstatOrNull } from "../shared/files.js";
import { inspectRepositoryIdentity } from "../shared/git.js";
import { createGitClient } from "../shared/git-client.js";
import { resolveWorkspace } from "../shared/workspace.js";

/**
 * Проверяет локальную identity Code Repository и наличие implementation commit.
 * Отсутствующий checkout — ожидаемое состояние чтения; некорректная identity
 * остаётся ошибкой конфигурации и не маскируется как отсутствие commit.
 *
 * @param {Awaited<ReturnType<import("../cycle/current.js").readCurrentCycle>>} context Текущий Cycle context.
 * @param {string} repositoryId Repository ID.
 * @param {string} revision Полная SHA-1 ревизия.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<{repositoryRoot: string, head: string | null, available: boolean}>} Локальное состояние commit.
 */
export async function inspectImplementationRevision(context, repositoryId, revision, commandRunner) {
  const repository = context.config.codeRepositories.find(({ id }) => id === repositoryId);
  const workspace = await resolveWorkspace(context.storeRoot, context.metadata.id, undefined, true);
  const repositoryRoot = path.join(workspace, "src", repositoryId);
  const stat = await lstatOrNull(repositoryRoot);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    return { repositoryRoot, head: null, available: false };
  }
  await inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const git = createGitClient(repositoryRoot, commandRunner);
  const [head, available] = await Promise.all([
    git.revision(),
    git.hasCommit(revision),
  ]);
  return { repositoryRoot, head, available };
}
