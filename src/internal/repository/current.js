/** @fileoverview Read-only identity текущего Code Repository для agent-facing status. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { PROJECT_SETTINGS } from "../config/settings.js";
import { runCommand } from "../shared/command.js";
import { createGitClient } from "../shared/git-client.js";
import { sameGitRemote } from "../shared/git.js";
import { readPointer } from "../shared/pointer.js";
import { resolveWorkspace } from "../shared/workspace.js";

/**
 * Определяет repository-id checkout, из которого вызвана команда.
 * Не требует default branch или чистого дерева: Apply работает в feature branch.
 *
 * @param {object} options Параметры.
 * @param {string} options.start Каталог вызова команды.
 * @param {string} options.storeRoot Канонический Store.
 * @param {object} options.metadata Проверенная Store metadata.
 * @param {import("../config/project.js").ProjectModel} options.project Доменный facade registry.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<{id: string, role: "store" | "code", path: string} | null>} Текущий repository.
 */
export async function readCurrentRepository({
  start,
  storeRoot,
  metadata,
  project,
  commandRunner = runCommand,
}) {
  let repositoryRoot;
  try {
    repositoryRoot = await fs.realpath(await createGitClient(start, commandRunner).repositoryRoot());
  } catch {
    return null;
  }

  if (repositoryRoot === storeRoot) {
    return { id: project.storeRepository.id, role: "store", path: storeRoot };
  }

  const workspace = await resolveWorkspace(storeRoot, metadata.id, undefined, true);
  for (const repository of project.codeRepositories) {
    const expectedPath = path.join(
      workspace,
      PROJECT_SETTINGS.workspace.repositoriesDirectory,
      repository.id,
    );
    let canonicalExpectedPath;
    try {
      canonicalExpectedPath = await fs.realpath(expectedPath);
    } catch {
      continue;
    }
    if (repositoryRoot !== canonicalExpectedPath) continue;

    const [storeId, remote] = await Promise.all([
      readPointer(repositoryRoot),
      createGitClient(repositoryRoot, commandRunner).originUrl().catch(() => ""),
    ]);
    if (storeId !== metadata.id || !sameGitRemote(remote, repository.remote)) {
      throw new Error(
        `REPO_IDENTITY_MISMATCH: checkout ${repositoryRoot} не соответствует repository-id '${repository.id}'`,
      );
    }
    return { id: repository.id, role: "code", path: repositoryRoot };
  }

  return null;
}
