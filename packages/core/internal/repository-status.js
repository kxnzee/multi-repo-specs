/** @fileoverview Read-only статус Repository registry без сети и исправлений. */

import process from "node:process";

import { RepositoryCheckout } from "./checkout.js";
import { coreState } from "./core-state.js";
import { lstatOrNull } from "./fs.js";
import { git } from "./git.js";
import { repositoryRunner, repositorySelector } from "./repository-operations.js";
import { storeProjects } from "./store-project.js";
import { workspace } from "./workspace.js";

export const REPOSITORY_STATUS_STATE = Object.freeze({
  connected: "connected",
  identityMismatch: "identity_mismatch",
  missing: "missing",
  notDirectory: "not_a_directory",
  notGitRepository: "not_a_git_repository",
  notGitRoot: "not_a_git_root",
  workspaceUnresolved: "workspace_unresolved",
  invalidSpecs: "invalid_specs",
});

const REPOSITORY_STATES = new Set(Object.values(REPOSITORY_STATUS_STATE));

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
  get error() { return this.#value.error; }
  get clean() { return this.#value.clean; }
}

/** Читает состояние Store и Code Repository checkouts без мутаций. */
export class RepositoryStatusService {
  #git;
  #runner;
  #selector;
  #state;
  #storeProjects;
  #workspace;

  constructor({
    gitService = git,
    repositoryRunnerService = repositoryRunner,
    repositorySelectorService = repositorySelector,
    stateService = coreState,
    storeProjectService = storeProjects,
    workspaceService = workspace,
  } = {}) {
    this.#git = gitService;
    this.#runner = repositoryRunnerService;
    this.#selector = repositorySelectorService;
    this.#state = stateService;
    this.#storeProjects = storeProjectService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async inspect({ start = process.cwd(), repositoryIds } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const selected = this.#selector.select(storeProject.project, { repositoryIds });
    const storedWorkspace = (await this.#state.forStore(storeProject.checkout).read()).workspace;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot: storeProject.root,
      storeId: storeProject.store.id,
      storedWorkspace,
    }).catch((error) => {
      if (error.code === "WORKSPACE_UNRESOLVED") return null;
      throw error;
    });
    return this.#runner.run(selected, async (repository) => {
      const expectedPath = repository.isStore()
        ? storeProject.root
        : workspaceModel?.checkoutPath(repository) ?? null;
      return expectedPath
        ? await this.#inspectRepository(repository, expectedPath, workspaceModel)
        : new RepositoryStatus({
          repository,
          state: REPOSITORY_STATUS_STATE.workspaceUnresolved,
        });
    });
  }

  async #inspectRepository(repository, expectedPath, workspaceModel) {
    const base = { repository, path: expectedPath, connected: false };
    const stat = await lstatOrNull(expectedPath);
    if (!stat) return new RepositoryStatus({ ...base, state: REPOSITORY_STATUS_STATE.missing });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return new RepositoryStatus({ ...base, state: REPOSITORY_STATUS_STATE.notDirectory });
    }
    if (repository.isSpecs()) {
      try {
        await this.#workspace.resolveCheckout(workspaceModel, repository);
      } catch {
        return new RepositoryStatus({ ...base, state: REPOSITORY_STATUS_STATE.notDirectory });
      }
    }
    const checkout = new RepositoryCheckout(repository, expectedPath);
    const repositoryGit = this.#git.forRepository(checkout);
    let root;
    try {
      root = await repositoryGit.repositoryRoot();
    } catch {
      return new RepositoryStatus({ ...base, state: REPOSITORY_STATUS_STATE.notGitRepository });
    }
    if (root !== expectedPath) {
      return new RepositoryStatus({ ...base, state: REPOSITORY_STATUS_STATE.notGitRoot });
    }
    const [remote, branch, clean] = await Promise.all([
      repositoryGit.originUrl().catch(() => ""),
      repositoryGit.currentBranch(),
      repositoryGit.isClean(),
    ]);
    const remoteMatches = repository.matchesRemote(remote);
    if (repository.isSpecs() && remoteMatches) {
      try {
        await this.#storeProjects.loadSpecs(checkout);
      } catch (error) {
        return new RepositoryStatus({ ...base, remote, remoteMatches, branch, clean,
          state: REPOSITORY_STATUS_STATE.invalidSpecs, error: error.message });
      }
    }
    return new RepositoryStatus({
      ...base,
      connected: true,
      state: remoteMatches
        ? REPOSITORY_STATUS_STATE.connected
        : REPOSITORY_STATUS_STATE.identityMismatch,
      remote,
      remoteMatches,
      branch,
      clean,
    });
  }
}

/** Общий read-only Repository Status facade нового Core. */
export const repositoryStatuses = Object.freeze(new RepositoryStatusService());
