/** @fileoverview Git-инварианты первого и повторного запуска `openspec-orch change`. */

import path from "node:path";

import { inspectFreshCheckout, inspectRepositoryIdentity } from "../shared/git.js";
import { createGitClient } from "../shared/git-client.js";
import { isContainedPath } from "../shared/paths.js";
import { isGitRevision } from "../shared/schema.js";

/**
 * Проверяет отсутствие локальной и remote planning-ветки.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} branch Ожидаемая planning-ветка.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<void>}
 */
async function assertBranchAbsent(projectRoot, branch, commandRunner) {
  const git = createGitClient(projectRoot, commandRunner);
  if (await git.hasLocalBranch(branch)) {
    throw new Error(`needs_recovery: локальная planning-ветка уже существует: ${branch}`);
  }
  if (await git.hasRemoteBranch(branch)) {
    throw new Error(`Remote planning-ветка уже существует: ${branch}`);
  }
}

/**
 * Проверяет первый запуск с чистой актуальной основной ветки.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../shared/types.js").RegisteredRepository} repository Store из openspec-orch.yaml.
 * @param {string} branch Новая planning-ветка.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<import("../shared/types.js").GitState>} Зафиксированная основная ветка и ревизия.
 */
export async function inspectInitialChangeGit(projectRoot, repository, branch, commandRunner) {
  const state = await inspectFreshCheckout(projectRoot, repository, commandRunner);
  await assertBranchAbsent(projectRoot, branch, commandRunner);
  return state;
}

/**
 * Проверяет безопасное продолжение шага в существующей planning-ветке.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../shared/types.js").RegisteredRepository} repository Store из openspec-orch.yaml.
 * @param {string} branch Ожидаемая planning-ветка.
 * @param {string} changeRoot Канонический каталог Change из OpenSpec status.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<import("../shared/types.js").GitState>} Текущая ветка и ревизия.
 */
export async function inspectContinuationChangeGit(
  projectRoot,
  repository,
  branch,
  changeRoot,
  commandRunner,
) {
  await inspectRepositoryIdentity(projectRoot, repository, commandRunner);
  const git = createGitClient(projectRoot, commandRunner);
  const actualBranch = await git.currentBranch();
  if (actualBranch !== branch) {
    throw new Error(`needs_recovery: Change должен находиться в ветке ${branch}`);
  }
  if (await git.hasRemoteBranch(branch)) {
    throw new Error(`needs_recovery: planning-ветка уже опубликована: ${branch}`);
  }
  if ((await git.countCommits(`${repository.defaultBranch}..HEAD`)) !== 0) {
    throw new Error("needs_recovery: в planning-ветке уже существуют commit до Planning PR");
  }
  const changedPaths = await git.statusPaths();
  const changeRelativePath = path.relative(projectRoot, changeRoot);
  if (!isContainedPath(projectRoot, changeRoot)) {
    throw new Error("needs_recovery: OpenSpec Change root выходит за Store");
  }
  const allowedRoot = changeRelativePath.split(path.sep).join("/");
  const allowedPrefix = `${allowedRoot}/`;
  const unexpected = changedPaths.filter(
    (filePath) => filePath !== allowedRoot && !filePath.startsWith(allowedPrefix),
  );
  if (unexpected.length > 0) {
    throw new Error(`needs_recovery: изменения вне текущего Change: ${unexpected.join(", ")}`);
  }
  const revision = await git.revision();
  if (!isGitRevision(revision)) throw new Error("Store: Git вернул некорректную ревизию");
  return { branch: actualBranch, revision };
}
