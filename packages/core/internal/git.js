/** @fileoverview Git facade, привязанный к RepositoryCheckout или Workspace. */

import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { processes } from "./process.js";

const GIT_OPERATION_MARKERS = Object.freeze([
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "rebase-merge",
  "rebase-apply",
]);

/** Разбирает пути из git status --porcelain=v1 -z. */
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
    if (CORE_PATTERNS.gitRenameOrCopyState.test(state)) {
      index += 1;
      if (!records[index]) throw new Error("Git вернул неполный rename/copy status");
      paths.push(records[index]);
    }
  }
  return paths;
}

/** Git API одного проверенного RepositoryCheckout. */
export class RepositoryGit {
  #scope;
  #process;

  constructor(scope, scopedProcess) {
    if (!scope || typeof scope.root !== "string" || scopedProcess?.cwd !== scope.root) {
      throw new Error("GIT_SCOPE_INVALID: scope и process должны иметь один canonical root");
    }
    this.#scope = scope;
    this.#process = scopedProcess;
    Object.freeze(this);
  }

  repositoryRoot() {
    return this.#run(["rev-parse", "--show-toplevel"]).then((root) => path.resolve(root));
  }

  originUrl() {
    return this.#run(["remote", "get-url", "origin"]);
  }

  currentBranch() {
    return this.#run(["branch", "--show-current"]);
  }

  async statusPaths(pathspec = []) {
    const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
    if (pathspec.length > 0) args.push("--", ...pathspec);
    return parseStatusPaths(await this.#run(args));
  }

  async isClean(pathspec = []) {
    return (await this.statusPaths(pathspec)).length === 0;
  }

  revision(ref = "HEAD") {
    return this.#run(["rev-parse", ref]);
  }

  async hasCommit(revision) {
    try {
      await this.#run(["cat-file", "-e", `${revision}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  gitPath(marker) {
    return this.#run(["rev-parse", "--git-path", marker]);
  }

  async assertNoOperation() {
    for (const marker of GIT_OPERATION_MARKERS) {
      const gitPath = await this.gitPath(marker);
      const target = path.resolve(this.#scope.root, gitPath);
      if (await lstatOrNull(target)) {
        throw new Error(
          `${this.#scope.root}: обнаружена незавершённая Git-операция (${marker})`,
        );
      }
    }
  }

  async assertIdentity() {
    const root = await this.repositoryRoot();
    if (root !== this.#scope.root) {
      throw new Error(`${this.#scope.id}: каталог не является корнем Git-репозитория`);
    }
    const remote = await this.originUrl();
    if (typeof this.#scope.repository?.remote !== "string") {
      throw new Error("GIT_SCOPE_INVALID: identity требует RepositoryCheckout");
    }
    if (!this.#scope.repository.matchesRemote(remote)) {
      throw new Error(`${this.#scope.id}: origin не совпадает с openspec-orch.yaml`);
    }
  }

  #run(args, options = {}) {
    return this.#process.run("git", args, options);
  }
}

/** Git API операций уровня Workspace до появления checkout. */
export class WorkspaceGit {
  #workspace;
  #process;

  constructor(workspace, scopedProcess) {
    this.#workspace = workspace;
    this.#process = scopedProcess;
    Object.freeze(this);
  }

  async clone(repository) {
    const target = this.#workspace.checkoutPath(repository);
    await this.#process.run(
      "git",
      [
        "clone",
        "--single-branch",
        "--no-tags",
        "--branch",
        repository.defaultBranch,
        "--",
        repository.remote,
        target,
      ],
      { sensitiveValues: [repository.remote] },
    );
    return target;
  }
}

/** Factory Git facades поверх ProcessService. */
export class GitService {
  #processService;

  constructor(processService = processes) {
    this.#processService = processService;
    Object.freeze(this);
  }

  forRepository(checkout) {
    return new RepositoryGit(checkout, this.#processService.forRepository(checkout));
  }

  forStoreTarget(target) {
    return new RepositoryGit(target, this.#processService.forStoreTarget(target));
  }

  forWorkspace(workspace) {
    return new WorkspaceGit(workspace, this.#processService.forWorkspace(workspace));
  }
}

/** Общий GitService нового Core. */
export const git = Object.freeze(new GitService());
