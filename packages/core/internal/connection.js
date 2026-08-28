/** @fileoverview Доменный сценарий подключения Store и multi-repo Workspace. */

import process from "node:process";

import { CORE_FILES, CORE_PATTERNS } from "./constants.js";
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
  get path() { return this.#value.path; }
  get branch() { return this.#value.branch; }
  get revision() { return this.#value.revision; }
  get cloned() { return this.#value.cloned; }
  get pointerCreated() { return this.#value.pointerCreated; }
  get pointerPending() { return this.#value.pointerPending; }
  get status() { return this.#value.status; }
}

/** Immutable результат полного Core connect. */
export class ConnectionResult {
  #storeId;
  #storeRoot;
  #workspace;
  #executionMode;
  #repositories;

  constructor({ storeId, storeRoot, workspace: workspaceRoot, executionMode, repositories }) {
    this.#storeId = storeId;
    this.#storeRoot = storeRoot;
    this.#workspace = workspaceRoot;
    this.#executionMode = executionMode;
    this.#repositories = Object.freeze([...repositories]);
    Object.freeze(this);
  }

  get storeId() { return this.#storeId; }
  get storeRoot() { return this.#storeRoot; }
  get workspace() { return this.#workspace; }
  get executionMode() { return this.#executionMode; }
  get repositories() { return this.#repositories; }
  get status() {
    return this.#repositories.some(({ pointerPending }) => pointerPending)
      ? "needs_setup_pr"
      : "ready";
  }
}

/** Подключает текущую машину через Core domain и scoped infrastructure facades. */
export class ConnectionService {
  #git;
  #openspec;
  #pointers;
  #state;
  #storeProjects;
  #workspace;

  constructor({
    gitService = git,
    openSpecService = openspec,
    pointerService = pointers,
    stateService = coreState,
    storeProjectService = storeProjects,
    workspaceService = workspace,
  } = {}) {
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
    noStrict = false,
  } = {}) {
    onProgress("Проверка Store и OpenSpec...");
    const storeProject = await this.#storeProjects.load(start);
    const { project, root: storeRoot, store: metadata } = storeProject;
    const executionMode = noStrict || !project.strict ? "relaxed" : "strict";
    const storeCheckout = storeProject.checkout;
    const storeOpenSpec = this.#openspec.forRepository(storeCheckout);
    await storeOpenSpec.version();
    await storeOpenSpec.registerStore();
    await storeOpenSpec.assertStoreHealthy();
    const doctorOutput = await storeOpenSpec.doctor(
      ["doctor", "--store", metadata.id],
      (message, severity) => onProgress(
        `${severity === "info" ? "Информация" : "Предупреждение"} OpenSpec:\n${message}`,
        severity,
      ),
    );
    if (doctorOutput) onProgress(doctorOutput, "info");
    await storeOpenSpec.assertContext({
      storeId: metadata.id,
      storeRoot,
      source: "store",
      storeOption: true,
    });
    const stateStore = this.#state.forStore(storeCheckout);
    const storedWorkspace = executionMode === "strict" ? (await stateStore.read()).workspace : null;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot,
      storeId: metadata.id,
      requestedWorkspace,
      storedWorkspace,
    });
    await workspaceModel.ensureRepositoriesRoot();
    const repositories = [];
    for (const [index, repository] of project.codeRepositories.entries()) {
      const prefix = `[${index + 1}/${project.codeRepositories.length}] ${repository.id}`;
      const connected = await this.#connectRepository({
        repository,
        workspaceModel,
        storeId: metadata.id,
        storeRoot,
        executionMode,
        onProgress: (message, status) => onProgress(`${prefix}: ${message}`, status),
      });
      repositories.push(connected);
      onProgress(`${prefix}: готово`, "success");
    }
    if (requestedWorkspace && executionMode === "strict") {
      await stateStore.update((current) => current.rememberWorkspace(workspaceModel.root));
    }
    return new ConnectionResult({
      storeId: metadata.id,
      storeRoot,
      workspace: workspaceModel.root,
      executionMode,
      repositories,
    });
  }

  async #connectRepository({
    repository,
    workspaceModel,
    storeId,
    storeRoot,
    executionMode,
    onProgress,
  }) {
    const repositoryRoot = workspaceModel.checkoutPath(repository);
    const existing = await lstatOrNull(repositoryRoot);
    let cloned = false;
    if (!existing) {
      if (executionMode === "relaxed") {
        throw new Error(
          `${repository.id}: relaxed mode требует существующий локальный каталог ${repositoryRoot}`,
        );
      }
      onProgress("клонирование...");
      await this.#git.forWorkspace(workspaceModel).clone(repository);
      cloned = true;
    } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`${repository.id}: checkout должен быть обычным каталогом`);
    } else onProgress("проверка существующего checkout...");
    const checkout = await this.#workspace.resolveCheckout(workspaceModel, repository);
    const repositoryGit = this.#git.forRepository(checkout);
    let branch = "unpinned";
    let revision = "unpinned";
    if (executionMode === "strict") {
      await repositoryGit.assertIdentity();
      branch = await repositoryGit.currentBranch();
      if (branch !== repository.defaultBranch) {
        throw new Error(`${repository.id}: ожидается ветка ${repository.defaultBranch}`);
      }
      const changedPaths = await repositoryGit.statusPaths();
      if (changedPaths.some((filePath) => filePath !== CORE_FILES.openSpecConfig)) {
        throw new Error(`${repository.id}: рабочее дерево должно быть чистым`);
      }
      revision = await repositoryGit.revision();
      if (!CORE_PATTERNS.gitRevision.test(revision)) {
        throw new Error(`${repository.id}: Git вернул некорректную ревизию`);
      }
    }
    const pointerCreated = await this.#pointers.connect(checkout, storeId);
    const pointerPending = executionMode === "strict" &&
      !await repositoryGit.isClean([CORE_FILES.openSpecConfig]);
    onProgress("проверка OpenSpec pointer...");
    const repositoryOpenSpec = this.#openspec.forRepository(checkout);
    const doctorOutput = await repositoryOpenSpec.doctor(["doctor"], (message, severity) => (
      onProgress(
        `${severity === "info" ? "Информация" : "Предупреждение"} OpenSpec:\n${message}`,
        severity,
      )
    ));
    if (doctorOutput) onProgress(doctorOutput, "info");
    await repositoryOpenSpec.assertContext({ storeId, storeRoot, source: "declared" });
    return new RepositoryConnection({
      id: repository.id,
      path: checkout.root,
      branch,
      revision,
      cloned,
      pointerCreated,
      pointerPending,
      status: pointerPending ? "needs_setup_pr" : "ready",
    });
  }

}

/** Общий Connection Service нового Core. */
export const connection = Object.freeze(new ConnectionService());
