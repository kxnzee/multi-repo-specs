/** @fileoverview Общие проверки identity и точной ревизии Git checkout. */

import { createGitClient } from "./git-client.js";
import { isGitRevision } from "./schema.js";

/**
 * Убирает незначимые завершающие слеши из Git URL перед сравнением.
 *
 * @param {string} value Git URL.
 * @returns {string} Нормализованный URL.
 */
function normalizeGitRemote(value) {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Сравнивает URL без завершающего слеша, не пытаясь переопределять Git-семантику.
 *
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function sameGitRemote(actual, expected) {
  return normalizeGitRemote(actual) === normalizeGitRemote(expected);
}

/**
 * Сверяет корень и origin локального checkout с записью `openspec-orch.yaml`.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {import("./types.js").RegisteredRepository} repository Ожидаемая identity.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<void>}
 */
export async function inspectRepositoryIdentity(repositoryRoot, repository, commandRunner) {
  const git = createGitClient(repositoryRoot, commandRunner);
  const gitRoot = await git.repositoryRoot();
  if (gitRoot !== repositoryRoot) {
    throw new Error(`${repository.id}: каталог не является корнем Git-репозитория`);
  }
  const origin = await git.originUrl();
  if (!sameGitRemote(origin, repository.url)) {
    throw new Error(`${repository.id}: origin не совпадает с openspec-orch.yaml`);
  }
}

/**
 * Проверяет чистоту, ветку и свежесть Git checkout относительно origin.
 *
 * @param {string} repositoryRoot Абсолютный путь checkout.
 * @param {import("./types.js").RegisteredRepository} repository Ожидаемая identity.
 * @param {typeof import("./command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<import("./types.js").GitState>} Проверенные ветка и точная ревизия.
 */
export async function inspectFreshCheckout(repositoryRoot, repository, commandRunner) {
  await inspectRepositoryIdentity(repositoryRoot, repository, commandRunner);
  const git = createGitClient(repositoryRoot, commandRunner);
  if (!(await git.isClean())) throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
  const branch = await git.currentBranch();
  if (branch !== repository.defaultBranch) {
    throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
  }
  if (!(await git.hasRemoteBranch(repository.defaultBranch))) {
    throw new Error(
      `${repository.id}: ветка ${repository.defaultBranch} отсутствует в origin; ` +
      `если это нужная ветка, опубликуйте её: git push -u origin ${repository.defaultBranch}`,
    );
  }
  await git.fetchRemoteBranch(repository.defaultBranch);
  const revision = await git.revision();
  const remoteRevision = await git.revision(`origin/${repository.defaultBranch}`);
  if (!isGitRevision(revision) || !isGitRevision(remoteRevision)) {
    throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
  }
  if (revision !== remoteRevision) {
    throw new Error(`${repository.id}: checkout не совпадает с origin/${repository.defaultBranch}`);
  }
  return { branch, revision };
}
