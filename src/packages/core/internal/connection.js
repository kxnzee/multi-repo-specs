/** @fileoverview Доменный сценарий подключения Store и multi-repo Workspace. */

import process from "node:process";

import { coreState } from "./core-state.js";
import { lstatOrNull } from "./fs.js";
import { git } from "./git.js";
import { openspec } from "./openspec.js";
import { pointers } from "./pointer.js";
import { storeProjects } from "./store-project.js";
import { workspace } from "./workspace.js";

/** Immutable результат подключения одного Code Repository. */
export class RepositoryConnection {
  #value;

  constructor(value) {
    this.#value = Object.freeze({ ...value });
    Object.freeze(this);
  }

  get id() { return this.#value.id; }
  get role() { return this.#value.role; }
  get storeId() { return this.#value.storeId; }
  get clean() { return this.#value.clean; }
  get path() { return this.#value.path; }
  get branch() { return this.#value.branch; }
  get revision() { return this.#value.revision; }
  get cloned() { return this.#value.cloned; }
  get pointerCreated() { return this.#value.pointerCreated; }
  get agentPackPending() { return this.#value.agentPackPending ?? false; }
  get pointerPending() { return this.#value.pointerPending; }
  get status() { return this.#value.status; }
}

/** Immutable результат полного Core connect. */
export class ConnectionResult {
  #storeId;
  #storeRoot;
  #workspace;
  #repositories;

  constructor({ storeId, storeRoot, workspace: workspaceRoot, repositories }) {
    this.#storeId = storeId;
    this.#storeRoot = storeRoot;
    this.#workspace = workspaceRoot;
    this.#repositories = Object.freeze([...repositories]);
    Object.freeze(this);
  }

  get storeId() { return this.#storeId; }
  get storeRoot() { return this.#storeRoot; }
  get workspace() { return this.#workspace; }
  get repositories() { return this.#repositories; }
  get status() {
    return this.#repositories.some(({ status }) => status === "files_changed")
      ? "files_changed"
      : "ready";
  }
}

/** Подключает текущую машину через Core domain и scoped infrastructure facades. */
export class ConnectionService {
  #packs;
  #git;
  #openspec;
  #pointers;
  #state;
  #storeProjects;
  #workspace;

  constructor({
    agentPackService,
    gitService = git,
    openSpecService = openspec,
    pointerService = pointers,
    stateService = coreState,
    storeProjectService = storeProjects,
    workspaceService = workspace,
  } = {}) {
    this.#packs = agentPackService;
    this.#git = gitService;
    this.#openspec = openSpecService;
    this.#pointers = pointerService;
    this.#state = stateService;
    this.#storeProjects = storeProjectService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async connect({
    start = process.cwd(),
    workspace: requestedWorkspace,
    onProgress = () => {},
  } = {}) {
    onProgress("Проверка Store и OpenSpec...");
    const storeProject = await this.#storeProjects.load(start);
    const { project, root: storeRoot, store: metadata } = storeProject;
    const storeCheckout = storeProject.checkout;
    const storeOpenSpec = this.#openspec.forRepository(storeCheckout);
    await storeOpenSpec.version();
    await storeOpenSpec.registerStore();
    await storeOpenSpec.assertStoreHealthy();
    await storeOpenSpec.doctor(
      ["doctor", "--store", metadata.id],
      (message, severity) => onProgress(
        `${severity === "info" ? "Информация" : "Предупреждение"} OpenSpec:\n${message}`,
        severity,
      ),
    );
    await storeOpenSpec.assertContext({
      storeId: metadata.id,
      storeRoot,
      source: "store",
      storeOption: true,
    });
    const stateStore = this.#state.forStore(storeCheckout);
    const storedWorkspace = (await stateStore.read()).workspace;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot,
      storeId: metadata.id,
      requestedWorkspace,
      storedWorkspace,
    });
    await workspaceModel.ensureRepositoriesRoot();
    if (project.specsRepositories.length > 0) await workspaceModel.ensureSpecsRoot();
    const agentPackPlan = await this.#packs?.plan(storeProject);
    const repositories = [];
    for (const [index, repository] of project.attachedRepositories.entries()) {
      const prefix = `[${index + 1}/${project.attachedRepositories.length}] ${repository.id}`;
      const connected = await this.#connectRepository({
        repository,
        agentPackPlan,
        workspaceModel,
        storeId: metadata.id,
        storeRoot,
        onProgress: (message, status) => onProgress(`${prefix}: ${message}`, status),
      });
      repositories.push(connected);
      onProgress(`${prefix}: готово`, "success");
    }
    if (requestedWorkspace) {
      await stateStore.update((current) => current.rememberWorkspace(workspaceModel.root));
    }
    return new ConnectionResult({
      storeId: metadata.id,
      storeRoot,
      workspace: workspaceModel.root,
      repositories,
    });
  }

  async #connectRepository({
    repository,
    agentPackPlan,
    workspaceModel,
    storeId,
    storeRoot,
    onProgress,
  }) {
    const repositoryRoot = workspaceModel.checkoutPath(repository);
    const existing = await lstatOrNull(repositoryRoot);
    let cloned = false;
    if (!existing) {
      onProgress("клонирование...");
      await this.#git.forWorkspace(workspaceModel).clone(repository);
      cloned = true;
    } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
    } else onProgress("проверка существующего checkout...");
    const checkout = await this.#workspace.resolveCheckout(workspaceModel, repository);
    if (repository.isSpecs()) {
      const target = await this.#storeProjects.loadSpecs(checkout);
      return new RepositoryConnection({
        id: repository.id, role: repository.role, storeId: target.store.id,
        path: checkout.root, cloned,
        pointerCreated: null, pointerPending: null, agentPackPending: false, status: "ready",
      });
    }
    await agentPackPlan?.check(checkout.root);
    const pointerCreated = await this.#pointers.connect(checkout, storeId);
    const installed = await agentPackPlan?.install(checkout.root);
    const agentPackPending = (installed?.length ?? 0) > 0;
    const pointerPending = pointerCreated;
    onProgress("проверка OpenSpec pointer...");
    const repositoryOpenSpec = this.#openspec.forRepository(checkout);
    await repositoryOpenSpec.doctor(["doctor"], (message, severity) => (
      onProgress(
        `${severity === "info" ? "Информация" : "Предупреждение"} OpenSpec:\n${message}`,
        severity,
      )
    ));
    await repositoryOpenSpec.assertContext({ storeId, storeRoot, source: "declared" });
    return new RepositoryConnection({
      id: repository.id,
      role: repository.role,
      path: checkout.root,
      cloned,
      pointerCreated,
      pointerPending,
      agentPackPending,
      status: pointerPending || agentPackPending ? "files_changed" : "ready",
    });
  }

}

/** Общий Connection Service нового Core. */
export const connection = Object.freeze(new ConnectionService());
