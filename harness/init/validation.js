/** @fileoverview Проверка CLI-входа и Git-предусловий `sdd init`. */

import path from "node:path";

const REPOSITORY_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(.+)#([^#]+)$/;

/**
 * Проверяет Git-предусловия и читает identity центрального репозитория.
 *
 * @param {string} projectRoot Абсолютный путь репозитория.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<{remote: string, defaultBranch: string}>} Origin и текущая ветка.
 */
export async function inspectGit(projectRoot, commandRunner) {
  const gitRoot = path.resolve(commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot }));
  if (gitRoot !== projectRoot) throw new Error("sdd init нужно запускать из корня центрального Git-репозитория");
  if (commandRunner("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: projectRoot })) {
    throw new Error("sdd init требует чистое рабочее дерево Git");
  }
  const remote = commandRunner("git", ["remote", "get-url", "origin"], { cwd: projectRoot });
  const defaultBranch = commandRunner("git", ["branch", "--show-current"], { cwd: projectRoot });
  if (!defaultBranch) throw new Error("sdd init нельзя запускать в detached HEAD");
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
