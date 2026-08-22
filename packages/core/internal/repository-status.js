/** @fileoverview Read-only статус Repository registry без сети и исправлений. */

import { promises as fs } from "node:fs";
import process from "node:process";

import { RepositoryCheckout } from "./checkout.js";
import { coreState } from "./core-state.js";
import { git } from "./git.js";
import { storeProjects } from "./store-project.js";
import { workspace } from "./workspace.js";

const REPOSITORY_STATES = new Set([
  "connected",
  "diverged",
  "missing",
  "not_a_directory",
  "not_a_git_repository",
  "not_a_git_root",
  "workspace_unresolved",
]);

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Immutable read-only состояние одного Repository. */
export class RepositoryStatus {
  #value;

  constructor(value) {
    if (!value?.repository || !REPOSITORY_STATES.has(value.state)) {
      throw new Error("REPOSITORY_STATUS_INVALID: Repository и известный state обязательны");
    }
    this.#value = Object.freeze({
      path: null,
      connected: false,
      ...value,
    });
    Object.freeze(this);
  }

  get id() { return this.#value.repository.id; }
  get role() { return this.#value.repository.role; }
  get path() { return this.#value.path; }
  get connected() { return this.#value.connected; }
  get state() { return this.#value.state; }
  get remote() { return this.#value.remote; }
  get remoteMatches() { return this.#value.remoteMatches; }
  get branch() { return this.#value.branch; }
  get branchMatches() { return this.#value.branchMatches; }
  get clean() { return this.#value.clean; }
}

/** Читает состояние Store и Code Repository checkouts без мутаций. */
export class RepositoryStatusService {
  #git;
  #state;
  #storeProjects;
  #workspace;

  constructor({
    gitService = git,
    stateService = coreState,
    storeProjectService = storeProjects,
    workspaceService = workspace,
  } = {}) {
    this.#git = gitService;
    this.#state = stateService;
    this.#storeProjects = storeProjectService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async inspect({ start = process.cwd(), repositoryIds } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const selected = storeProject.project.selectRepositories(repositoryIds);
    const storedWorkspace = (await this.#state.forStore(storeProject.checkout).read()).workspace;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot: storeProject.root,
      storeId: storeProject.store.id,
      storedWorkspace,
    }).catch((error) => {
      if (error.code === "WORKSPACE_UNRESOLVED") return null;
      throw error;
    });
    const statuses = [];
    for (const repository of selected) {
      const expectedPath = repository.isStore()
        ? storeProject.root
        : workspaceModel?.checkoutPath(repository) ?? null;
      statuses.push(expectedPath
        ? await this.#inspectRepository(repository, expectedPath)
        : new RepositoryStatus({ repository, state: "workspace_unresolved" }));
    }
    return Object.freeze(statuses);
  }

  async #inspectRepository(repository, expectedPath) {
    const base = { repository, path: expectedPath, connected: false };
    const stat = await lstatOrNull(expectedPath);
    if (!stat) return new RepositoryStatus({ ...base, state: "missing" });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return new RepositoryStatus({ ...base, state: "not_a_directory" });
    }
    const checkout = new RepositoryCheckout(repository, expectedPath);
    const repositoryGit = this.#git.forRepository(checkout);
    let root;
    try {
      root = await repositoryGit.repositoryRoot();
    } catch {
      return new RepositoryStatus({ ...base, state: "not_a_git_repository" });
    }
    if (root !== expectedPath) {
      return new RepositoryStatus({ ...base, state: "not_a_git_root" });
    }
    const [remote, branch, clean] = await Promise.all([
      repositoryGit.originUrl().catch(() => ""),
      repositoryGit.currentBranch(),
      repositoryGit.isClean(),
    ]);
    const remoteMatches = repository.matchesRemote(remote);
    const branchMatches = branch === repository.defaultBranch;
    return new RepositoryStatus({
      ...base,
      connected: true,
      state: remoteMatches && branchMatches ? "connected" : "diverged",
      remote,
      remoteMatches,
      branch,
      branchMatches,
      clean,
    });
  }
}

/** Общий read-only Repository Status facade нового Core. */
export const repositoryStatuses = Object.freeze(new RepositoryStatusService());
