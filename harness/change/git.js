/** @fileoverview Git-инварианты первого и повторного запуска `sdd change`. */

import { inspectFreshCheckout, inspectRepositoryIdentity } from "../explore/validation/git.js";
import { isGitRevision } from "../shared/schema.js";

/**
 * Возвращает текущую Git-ветку Store.
 *
 * @param {string} projectRoot Корень Store.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {string} Имя текущей ветки.
 */
export function currentBranch(projectRoot, commandRunner) {
  return commandRunner("git", ["branch", "--show-current"], { cwd: projectRoot });
}

/**
 * Проверяет отсутствие локальной и remote planning-ветки.
 *
 * @param {string} projectRoot Корень Store.
 * @param {string} branch Ожидаемая planning-ветка.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {void}
 */
function assertBranchAbsent(projectRoot, branch, commandRunner) {
  const local = commandRunner(
    "git",
    ["branch", "--list", branch, "--format=%(refname:short)"],
    { cwd: projectRoot },
  );
  if (local) throw new Error(`needs_recovery: локальная planning-ветка уже существует: ${branch}`);
  const remote = commandRunner(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    { cwd: projectRoot },
  );
  if (remote) throw new Error(`Remote planning-ветка уже существует: ${branch}`);
}

/**
 * Проверяет первый запуск с чистой актуальной основной ветки.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../shared/types.js").RegisteredRepository} repository Store из sdd.yaml.
 * @param {string} branch Новая planning-ветка.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {import("../shared/types.js").GitState} Зафиксированная основная ветка и ревизия.
 */
export function inspectInitialChangeGit(projectRoot, repository, branch, commandRunner) {
  const state = inspectFreshCheckout(projectRoot, repository, commandRunner);
  assertBranchAbsent(projectRoot, branch, commandRunner);
  return state;
}

/**
 * Разбирает пути из `git status --porcelain=v1 -z`.
 *
 * @param {string} output Машинный вывод Git.
 * @returns {string[]} Все затронутые пути, включая исходный путь rename/copy.
 */
function parseStatusPaths(output) {
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git вернул некорректный porcelain status");
    }
    const state = record.slice(0, 2);
    paths.push(record.slice(3));
    if (/[RC]/.test(state)) {
      index += 1;
      if (!records[index]) throw new Error("Git вернул неполный rename/copy status");
      paths.push(records[index]);
    }
  }
  return paths;
}

/**
 * Проверяет безопасное продолжение шага в существующей planning-ветке.
 *
 * @param {string} projectRoot Корень Store.
 * @param {import("../shared/types.js").RegisteredRepository} repository Store из sdd.yaml.
 * @param {string} branch Ожидаемая planning-ветка.
 * @param {string} changeId Change ID.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {import("../shared/types.js").GitState} Текущая ветка и ревизия.
 */
export function inspectContinuationChangeGit(
  projectRoot,
  repository,
  branch,
  changeId,
  commandRunner,
) {
  inspectRepositoryIdentity(projectRoot, repository, commandRunner);
  const actualBranch = currentBranch(projectRoot, commandRunner);
  if (actualBranch !== branch) {
    throw new Error(`needs_recovery: Change должен находиться в ветке ${branch}`);
  }
  const remote = commandRunner(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    { cwd: projectRoot },
  );
  if (remote) throw new Error(`needs_recovery: planning-ветка уже опубликована: ${branch}`);
  const commits = commandRunner(
    "git",
    ["rev-list", "--count", `${repository.defaultBranch}..HEAD`],
    { cwd: projectRoot },
  );
  if (commits !== "0") {
    throw new Error("needs_recovery: в planning-ветке уже существуют commit до Planning PR");
  }
  const status = commandRunner(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: projectRoot },
  );
  const allowedPrefix = `openspec/changes/${changeId}/`;
  const unexpected = parseStatusPaths(status).filter(
    (filePath) => filePath !== `openspec/changes/${changeId}` && !filePath.startsWith(allowedPrefix),
  );
  if (unexpected.length > 0) {
    throw new Error(`needs_recovery: изменения вне текущего Change: ${unexpected.join(", ")}`);
  }
  const revision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
  if (!isGitRevision(revision)) throw new Error("Store: Git вернул некорректную ревизию");
  return { branch: actualBranch, revision };
}
