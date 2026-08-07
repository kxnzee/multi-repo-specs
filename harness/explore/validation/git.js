/** @fileoverview Проверки identity и точной ревизии Git checkout для Explore. */

import path from "node:path";

import { sameGitRemote } from "../../config/index.js";
import { isGitRevision } from "../../shared/schema.js";

/**
 * Сверяет корень и origin локального checkout с записью `sdd.yaml`.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {import("../../shared/types.js").RegisteredRepository} repository Ожидаемая identity.
 * @param {typeof import("../../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {void}
 */
export function inspectRepositoryIdentity(repositoryRoot, repository, commandRunner) {
  const gitRoot = path.resolve(
    commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }),
  );
  if (gitRoot !== repositoryRoot) {
    throw new Error(`${repository.id}: каталог не является корнем Git-репозитория`);
  }
  const origin = commandRunner("git", ["remote", "get-url", "origin"], {
    cwd: repositoryRoot,
  });
  if (!sameGitRemote(origin, repository.url)) {
    throw new Error(`${repository.id}: origin не совпадает с sdd.yaml`);
  }
}

/**
 * Проверяет чистоту, ветку и свежесть Git checkout относительно origin.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {import("../../shared/types.js").RegisteredRepository} repository Ожидаемая identity.
 * @param {typeof import("../../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {import("../../shared/types.js").GitState} Проверенные ветка и точная ревизия.
 */
export function inspectFreshCheckout(repositoryRoot, repository, commandRunner) {
  inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const changes = commandRunner(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repositoryRoot },
  );
  if (changes) throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  const branch = commandRunner("git", ["branch", "--show-current"], { cwd: repositoryRoot });
  if (branch !== repository.defaultBranch) {
    throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  }
  commandRunner("git", ["fetch", "origin", repository.defaultBranch], { cwd: repositoryRoot });
  const revision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const remoteRevision = commandRunner(
    "git",
    ["rev-parse", `origin/${repository.defaultBranch}`],
    { cwd: repositoryRoot },
  );
  if (!isGitRevision(revision) || !isGitRevision(remoteRevision)) {
    throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
  }
  if (revision !== remoteRevision) {
    throw new Error(`${repository.id}: checkout не совпадает с origin/${repository.defaultBranch}`);
  }
  return { branch, revision };
}
