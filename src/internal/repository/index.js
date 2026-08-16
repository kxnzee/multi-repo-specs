/** @fileoverview Read-only `repository status`: не чинит расхождения, не ходит в сеть. */

import path from "node:path";

import { runCommand } from "../shared/command.js";
import { lstatOrNull } from "../shared/files.js";
import { createGitClient } from "../shared/git-client.js";
import { sameGitRemote } from "../shared/git.js";
import { readStoreConfiguration } from "../shared/store.js";
import { resolveWorkspace } from "../shared/workspace.js";

/**
 * Проверяет один локальный checkout только чтением, без сети и исправлений.
 *
 * @param {{id: string, role: "store" | "code", remote: string, defaultBranch: string}} repository Репозиторий реестра.
 * @param {string} expectedPath Ожидаемый локальный путь.
 * @param {typeof runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<import("./types.js").RepositoryStatus>} Проверенный статус.
 */
async function inspectRepository(repository, expectedPath, commandRunner) {
  const base = { id: repository.id, role: repository.role, path: expectedPath, connected: false };
  const stat = await lstatOrNull(expectedPath);
  if (!stat) return { ...base, state: "missing" };
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { ...base, state: "not_a_directory" };

  const git = createGitClient(expectedPath, commandRunner);
  let root;
  try {
    root = await git.repositoryRoot();
  } catch {
    return { ...base, state: "not_a_git_repository" };
  }
  if (root !== expectedPath) return { ...base, state: "not_a_git_root" };

  const [remote, branch, clean] = await Promise.all([
    git.originUrl().catch(() => ""),
    git.currentBranch(),
    git.isClean(),
  ]);
  const remoteMatches = sameGitRemote(remote, repository.remote);
  const branchMatches = branch === repository.defaultBranch;
  return {
    ...base,
    connected: true,
    state: remoteMatches && branchMatches ? "connected" : "diverged",
    remote,
    remoteMatches,
    branch,
    branchMatches,
    clean,
  };
}

/**
 * Читает только состояние всех либо выбранных репозиториев реестра: подключён/отсутствует,
 * чистая ли копия, совпадает ли remote и ветка. Не выполняет clone/fetch/pull/checkout.
 *
 * @param {object} options Параметры.
 * @param {string} options.storeRoot Канонический путь рабочей копии Store.
 * @param {string[]} [options.repositoryIds] Ограничение вывода конкретными repository-id.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<import("./types.js").RepositoryStatus[]>} Проверенные статусы.
 */
export async function readRepositoryStatus({ storeRoot, repositoryIds, commandRunner = runCommand }) {
  const { metadata, config } = await readStoreConfiguration(storeRoot);

  let selected = config.repositories;
  if (repositoryIds && repositoryIds.length > 0) {
    const known = new Set(config.repositories.map(({ id }) => id));
    for (const id of repositoryIds) {
      if (!known.has(id)) throw new Error(`REPO_UNKNOWN: repository-id '${id}' отсутствует в openspec-orch.yaml`);
    }
    const wanted = new Set(repositoryIds);
    selected = config.repositories.filter(({ id }) => wanted.has(id));
  }

  const workspace = await resolveWorkspace(storeRoot, metadata.id, undefined, true).catch(() => null);
  const statuses = [];
  for (const repository of selected) {
    const expectedPath = repository.role === "store"
      ? storeRoot
      : (workspace ? path.join(workspace, "src", repository.id) : null);
    if (!expectedPath) {
      statuses.push({
        id: repository.id,
        role: repository.role,
        path: null,
        connected: false,
        state: "workspace_unresolved",
      });
      continue;
    }
    statuses.push(await inspectRepository(repository, expectedPath, commandRunner));
  }
  return statuses;
}
