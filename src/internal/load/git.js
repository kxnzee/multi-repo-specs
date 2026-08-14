/** @fileoverview Ограниченные Git-операции шага подготовки реализации. */

import path from "node:path";

import { lstatOrNull } from "../shared/files.js";
import { inspectRepositoryIdentity } from "../shared/git.js";
import { createGitClient } from "../shared/git-client.js";
import { isGitRevision } from "../shared/schema.js";

/** @param {string} root @param {typeof import("../shared/command.js").runCommand} runner @returns {Promise<void>} */
export async function assertClean(root, runner) {
  if (!(await createGitClient(root, runner).isClean())) {
    throw new Error(`${root}: рабочее дерево должно быть чистым`);
  }
}

/**
 * Проверяет отсутствие merge/rebase/cherry-pick/revert/bisect.
 *
 * @param {string} root
 * @param {typeof import("../shared/command.js").runCommand} runner
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

/**
 * Загружает Git-объекты Store и проверяет точную commit SHA.
 *
 * @param {string} storeRoot
 * @param {string} baseline
 * @param {typeof import("../shared/command.js").runCommand} runner
 * @returns {Promise<void>}
 */
export async function fetchStoreObjects(storeRoot, baseline, runner) {
  const git = createGitClient(storeRoot, runner);
  await git.fetchOrigin();
  const commit = await git.revision(`${baseline}^{commit}`);
  if (commit !== baseline) throw new Error("spec_baseline не является точной Git commit SHA Store");
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
  const storeGit = createGitClient(storeRoot, commandRunner);
  const registered = await storeGit.worktreePaths();
  const state = await lstatOrNull(worktreeRoot);
  if (state?.isSymbolicLink() || (state && !state.isDirectory())) {
    throw new Error(`Runtime Store path должен быть обычным каталогом: ${worktreeRoot}`);
  }
  if (state && !registered.has(worktreeRoot)) {
    throw new Error(`Runtime Store path существует, но не принадлежит worktree зарегистрированного Store: ${worktreeRoot}`);
  }
  if (state) {
    let reusable = false;
    try {
      const worktreeGit = createGitClient(worktreeRoot, commandRunner);
      const root = await worktreeGit.repositoryRoot();
      const revision = await worktreeGit.revision();
      reusable = root === worktreeRoot && revision === baseline && await worktreeGit.isClean();
    } catch {
      reusable = false;
    }
    if (reusable) return "reused";
  }
  if (state || registered.has(worktreeRoot)) {
    await storeGit.removeWorktree(worktreeRoot);
    await storeGit.addDetachedWorktree(worktreeRoot, baseline);
    return "recreated";
  }
  await storeGit.addDetachedWorktree(worktreeRoot, baseline);
  return "created";
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
  await inspectRepositoryIdentity(codeRoot, repository, commandRunner);
  await assertClean(codeRoot, commandRunner);
  await assertNoGitOperation(codeRoot, commandRunner);
  const git = createGitClient(codeRoot, commandRunner);
  await git.fetchOrigin();

  const branch = `feature/${changeId}`;
  const current = await git.currentBranch();
  const refs = await git.refs(["refs/heads", "refs/remotes/origin"]);
  const local = refs.has(`refs/heads/${branch}`);
  const remote = refs.has(`refs/remotes/origin/${branch}`);
  const defaultRemote = `origin/${repository.defaultBranch}`;
  const defaultRevision = await git.revision(defaultRemote);
  if (!isGitRevision(defaultRevision)) throw new Error(`${repository.id}: Git вернул некорректную основную ревизию`);

  let branchStatus;
  if (!local) {
    if (remote) {
      await git.createBranch(branch, { startPoint: `origin/${branch}`, track: true });
      branchStatus = "tracking";
    } else {
      await git.createBranch(branch, { startPoint: defaultRemote });
      branchStatus = "created";
    }
  } else {
    if (current !== branch) {
      throw new Error(`${repository.id}: существующая ветка ${branch} должна быть выбрана пользователем`);
    }
    const upstream = await git.branchUpstream(branch);
    if (upstream && upstream !== `origin/${branch}`) {
      throw new Error(`${repository.id}: ветка ${branch} отслеживает неожиданный upstream ${upstream}`);
    }
    if (remote) {
      let divergence;
      try {
        divergence = await git.divergence(branch, `origin/${branch}`);
      } catch (error) {
        throw new Error(`${repository.id}: ${error.message}`, { cause: error });
      }
      const { localOnly, remoteOnly } = divergence;
      if (remoteOnly > 0) {
        const reason = localOnly > 0 ? "diverged" : "отстаёт от";
        throw new Error(`${repository.id}: ветка ${branch} ${reason} origin/${branch}`);
      }
    }
    branchStatus = "existing";
  }

  const head = await git.revision();
  if (!isGitRevision(head)) throw new Error(`${repository.id}: Git вернул некорректную HEAD`);
  const codeBaseRevision = branchStatus === "created"
    ? defaultRevision
    : await git.mergeBase("HEAD", defaultRemote);
  if (!isGitRevision(codeBaseRevision)) {
    throw new Error(`${repository.id}: не удалось определить code_base_revision`);
  }
  return { branch, branchStatus, codeBaseRevision };
}
