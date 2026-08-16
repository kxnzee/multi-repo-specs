/** @fileoverview Общие проверки identity и точной ревизии Git checkout. */

import path from "node:path";

import { lstatOrNull } from "./files.js";
import { createGitClient } from "./git-client.js";

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
  if (!sameGitRemote(origin, repository.remote)) {
    throw new Error(`${repository.id}: origin не совпадает с openspec-orch.yaml`);
  }
}

/**
 * Проверяет отсутствие merge/rebase/cherry-pick/revert/bisect.
 *
 * @param {string} root Абсолютный путь checkout.
 * @param {typeof import("./command.js").runCommand} runner Исполнитель Git.
 * @returns {Promise<void>}
 */
export async function assertNoGitOperation(root, runner) {
  const git = createGitClient(root, runner);
  const markers = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"];
  for (const marker of markers) {
    const gitPath = await git.gitPath(marker);
    const target = path.resolve(root, gitPath);
    if (await lstatOrNull(target)) {
      throw new Error(`${root}: обнаружена незавершённая Git-операция (${marker})`);
    }
  }
}
