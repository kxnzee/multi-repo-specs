/** @fileoverview Проверка CLI-входа и Git-предусловий `openspec-orch init`. */

import { createGitClient } from "../shared/git-client.js";

const REPOSITORY_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/;

/**
 * Проверяет Git-предусловия и читает identity центрального репозитория.
 *
 * @param {string} projectRoot Абсолютный путь репозитория.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<{remote: string, defaultBranch: string}>} Origin и текущая ветка.
 */
export async function inspectGit(projectRoot, commandRunner) {
  const git = createGitClient(projectRoot, commandRunner);
  const gitRoot = await git.repositoryRoot();
  if (gitRoot !== projectRoot) throw new Error("openspec-orch init нужно запускать из корня центрального Git-репозитория");
  if (!(await git.isClean())) {
    throw new Error("openspec-orch init требует чистое рабочее дерево Git");
  }
  const remote = await git.originUrl();
  const defaultBranch = await git.currentBranch();
  if (!defaultBranch) throw new Error("openspec-orch init нельзя запускать в detached HEAD");
  return { remote, defaultBranch };
}

/**
 * Разбирает CLI-флаг `--repo <id=url#branch>`.
 *
 * @param {string} value Значение флага.
 * @returns {{id: string, role: "code", url: string, defaultBranch: string}} Репозиторий.
 */
export function parseRepository(value) {
  const match = value.match(REPOSITORY_PATTERN);
  if (!match) throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  const [, id, url, defaultBranch] = match;
  if (url.startsWith("-") || defaultBranch.startsWith("-")) {
    throw new Error(`Некорректный репозиторий '${value}'. Ожидается <id=url#branch>`);
  }
  return { id, role: "code", url, defaultBranch };
}
