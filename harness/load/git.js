/** @fileoverview Ограниченные Git-операции шага подготовки реализации. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { sameGitRemote } from "../config/index.js";
import { isGitRevision } from "../shared/schema.js";

/** @param {string} root @param {typeof import("../shared/command.js").runCommand} runner */
export function assertClean(root, runner) {
  const status = runner("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
  if (status) throw new Error(`${root}: рабочее дерево должно быть чистым`);
}

/**
 * Проверяет корень и origin checkout.
 *
 * @param {string} root
 * @param {string} expectedRemote
 * @param {string} label
 * @param {typeof import("../shared/command.js").runCommand} runner
 * @returns {string} Фактический origin.
 */
export function assertRepositoryIdentity(root, expectedRemote, label, runner) {
  const gitRoot = path.resolve(runner("git", ["rev-parse", "--show-toplevel"], { cwd: root }));
  if (gitRoot !== root) throw new Error(`${label}: команда должна запускаться из корня Git-репозитория`);
  const origin = runner("git", ["remote", "get-url", "origin"], { cwd: root });
  if (!sameGitRemote(origin, expectedRemote)) throw new Error(`${label}: origin не совпадает с openspec-orch.yaml`);
  return origin;
}

/**
 * Проверяет отсутствие merge/rebase/cherry-pick/revert/bisect.
 *
 * @param {string} root
 * @param {typeof import("../shared/command.js").runCommand} runner
 * @returns {Promise<void>}
 */
export async function assertNoGitOperation(root, runner) {
  const markers = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"];
  for (const marker of markers) {
    const gitPath = runner("git", ["rev-parse", "--git-path", marker], { cwd: root });
    const target = path.resolve(root, gitPath);
    try {
      await fs.lstat(target);
      throw new Error(`${root}: обнаружена незавершённая Git-операция (${marker})`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

/**
 * Загружает Git-объекты Store и проверяет точную commit SHA.
 *
 * @param {string} storeRoot
 * @param {string} baseline
 * @param {typeof import("../shared/command.js").runCommand} runner
 * @returns {void}
 */
export function fetchStoreObjects(storeRoot, baseline, runner) {
  runner("git", ["fetch", "--no-tags", "origin"], { cwd: storeRoot });
  const commit = runner("git", ["rev-parse", `${baseline}^{commit}`], { cwd: storeRoot });
  if (commit !== baseline) throw new Error("spec_baseline не является точной Git commit SHA Store");
}

/** @param {string} output @returns {Set<string>} */
function worktreePaths(output) {
  return new Set(
    output.split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => path.resolve(line.slice("worktree ".length))),
  );
}

/**
 * Создаёт либо переиспользует detached worktree точного Baseline.
 * Изменённый зарегистрированный runtime-worktree считается воспроизводимым и удаляется.
 *
 * @param {object} options
 * @param {string} options.storeRoot
 * @param {string} options.worktreeRoot
 * @param {string} options.baseline
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner
 * @returns {Promise<"created" | "reused" | "recreated">}
 */
export async function ensureStoreWorktree({ storeRoot, worktreeRoot, baseline, commandRunner }) {
  const registered = worktreePaths(
    commandRunner("git", ["worktree", "list", "--porcelain"], { cwd: storeRoot }),
  );
  let state;
  try {
    state = await fs.lstat(worktreeRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state?.isSymbolicLink() || (state && !state.isDirectory())) {
    throw new Error(`Runtime Store path должен быть обычным каталогом: ${worktreeRoot}`);
  }
  if (state && !registered.has(worktreeRoot)) {
    throw new Error(`Runtime Store path существует, но не принадлежит worktree зарегистрированного Store: ${worktreeRoot}`);
  }
  if (state) {
    let reusable = false;
    try {
      const root = path.resolve(commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd: worktreeRoot }));
      const revision = commandRunner("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot });
      const status = commandRunner("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: worktreeRoot,
      });
      reusable = root === worktreeRoot && revision === baseline && !status;
    } catch {
      reusable = false;
    }
    if (reusable) return "reused";
    commandRunner("git", ["worktree", "remove", "--force", worktreeRoot], { cwd: storeRoot });
    commandRunner("git", ["worktree", "add", "--detach", worktreeRoot, baseline], { cwd: storeRoot });
    return "recreated";
  }
  if (registered.has(worktreeRoot)) {
    commandRunner("git", ["worktree", "remove", "--force", worktreeRoot], { cwd: storeRoot });
    commandRunner("git", ["worktree", "add", "--detach", worktreeRoot, baseline], { cwd: storeRoot });
    return "recreated";
  }
  commandRunner("git", ["worktree", "add", "--detach", worktreeRoot, baseline], { cwd: storeRoot });
  return "created";
}

/** @param {string} output @returns {Set<string>} */
function refNames(output) {
  return new Set(output.split(/\r?\n/).filter(Boolean));
}

/**
 * Подготавливает implementation-ветку без изменения истории.
 *
 * @param {object} options
 * @param {string} options.codeRoot
 * @param {{id: string, url: string, defaultBranch: string}} options.repository
 * @param {string} options.changeId
 * @param {typeof import("../shared/command.js").runCommand} options.commandRunner
 * @returns {Promise<{branch: string, branchStatus: "created" | "tracking" | "existing", codeBaseRevision: string}>}
 */
export async function prepareImplementationBranch({
  codeRoot,
  repository,
  changeId,
  commandRunner,
}) {
  assertRepositoryIdentity(codeRoot, repository.url, repository.id, commandRunner);
  assertClean(codeRoot, commandRunner);
  await assertNoGitOperation(codeRoot, commandRunner);
  commandRunner("git", ["fetch", "--no-tags", "origin"], { cwd: codeRoot });

  const branch = `feature/${changeId}`;
  const current = commandRunner("git", ["branch", "--show-current"], { cwd: codeRoot });
  const refs = refNames(commandRunner(
    "git",
    ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"],
    { cwd: codeRoot },
  ));
  const local = refs.has(`refs/heads/${branch}`);
  const remote = refs.has(`refs/remotes/origin/${branch}`);
  const defaultRemote = `origin/${repository.defaultBranch}`;
  const defaultRevision = commandRunner("git", ["rev-parse", defaultRemote], { cwd: codeRoot });
  if (!isGitRevision(defaultRevision)) throw new Error(`${repository.id}: Git вернул некорректную основную ревизию`);

  let branchStatus;
  if (!local) {
    if (remote) {
      commandRunner("git", ["switch", "--track", "-c", branch, `origin/${branch}`], { cwd: codeRoot });
      branchStatus = "tracking";
    } else {
      commandRunner("git", ["switch", "--no-track", "-c", branch, defaultRemote], { cwd: codeRoot });
      branchStatus = "created";
    }
  } else {
    if (current !== branch) {
      throw new Error(`${repository.id}: существующая ветка ${branch} должна быть выбрана пользователем`);
    }
    const upstream = commandRunner(
      "git",
      ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`],
      { cwd: codeRoot },
    );
    if (upstream && upstream !== `origin/${branch}`) {
      throw new Error(`${repository.id}: ветка ${branch} отслеживает неожиданный upstream ${upstream}`);
    }
    if (remote) {
      const divergence = commandRunner(
        "git",
        ["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`],
        { cwd: codeRoot },
      ).trim().split(/\s+/).map(Number);
      if (divergence.length !== 2 || divergence.some((value) => !Number.isInteger(value))) {
        throw new Error(`${repository.id}: Git вернул некорректный статус upstream`);
      }
      const [localOnly, remoteOnly] = divergence;
      if (remoteOnly > 0) {
        const reason = localOnly > 0 ? "diverged" : "отстаёт от";
        throw new Error(`${repository.id}: ветка ${branch} ${reason} origin/${branch}`);
      }
    }
    branchStatus = "existing";
  }

  const head = commandRunner("git", ["rev-parse", "HEAD"], { cwd: codeRoot });
  if (!isGitRevision(head)) throw new Error(`${repository.id}: Git вернул некорректную HEAD`);
  const codeBaseRevision = branchStatus === "created"
    ? defaultRevision
    : commandRunner("git", ["merge-base", "HEAD", defaultRemote], { cwd: codeRoot });
  if (!isGitRevision(codeBaseRevision)) {
    throw new Error(`${repository.id}: не удалось определить code_base_revision`);
  }
  return { branch, branchStatus, codeBaseRevision };
}
