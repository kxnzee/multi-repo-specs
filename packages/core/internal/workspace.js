/** @fileoverview Доменная модель и read-only resolution multi-repo Workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CORE_FILES } from "./constants.js";
import { RepositoryCheckout } from "./checkout.js";
import { CORE_SETTINGS } from "./settings.js";

/** Канонический Workspace с единым правилом размещения Code Repositories. */
export class Workspace {
  #root;

  constructor(root) {
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new Error(`WORKSPACE_INVALID: root должен быть абсолютным путём: ${root}`);
    }
    this.#root = path.normalize(root);
    Object.freeze(this);
  }

  get root() {
    return this.#root;
  }

  get repositoriesRoot() {
    return path.join(this.#root, CORE_SETTINGS.workspace.repositoriesDirectory);
  }

  checkoutPath(repository) {
    if (!repository.isCode()) {
      throw new Error(
        `WORKSPACE_ROLE_UNSUPPORTED: Repository ${repository.id} с role ${repository.role} ` +
          "не размещается в каталоге Code Repositories",
      );
    }
    return path.join(this.repositoriesRoot, repository.id);
  }

  async ensureRepositoriesRoot() {
    const existing = await this.#lstatOrNull(this.repositoriesRoot);
    if (!existing) {
      try {
        await fs.mkdir(this.repositoriesRoot);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const stat = await fs.lstat(this.repositoriesRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        `WORKSPACE_INVALID: ${this.repositoriesRoot} должен быть обычным каталогом`,
      );
    }
    return this.repositoriesRoot;
  }

  async #lstatOrNull(target) {
    try {
      return await fs.lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
}

/** Read-only API разрешения Workspace и существующих checkout paths. */
export class WorkspaceResolver {
  async resolve({ storeRoot, storeId, requestedWorkspace, storedWorkspace }) {
    const remembered = storedWorkspace ? path.resolve(storedWorkspace) : "";
    const candidate = requestedWorkspace
      ? path.resolve(requestedWorkspace)
      : remembered || this.inferStandard(storeRoot, storeId);
    if (!candidate) {
      throw Object.assign(
        new Error(
          `Не удалось определить workspace; разместите Store как <workspace>/${storeId} ` +
            "или один раз выполните openspec-orch connect --workspace <path>",
        ),
        { code: "WORKSPACE_UNRESOLVED" },
      );
    }
    const stat = await this.#lstatOrNull(candidate);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      if (remembered) {
        throw new Error(
          `Сохранённый workspace недоступен: ${candidate}; ` +
            "повторите openspec-orch connect --workspace <path>",
        );
      }
      throw new Error(`Workspace должен быть обычным каталогом: ${candidate}`);
    }
    return new Workspace(await fs.realpath(candidate));
  }

  inferStandard(storeRoot, storeId) {
    const workspaceRoot = path.dirname(storeRoot);
    return (
      path.basename(storeRoot) === storeId &&
      path.basename(workspaceRoot) !== CORE_FILES.openSpecDirectory &&
      path.dirname(workspaceRoot) !== workspaceRoot
    ) ? workspaceRoot : null;
  }

  async fromCodeRepository(repositoryRoot) {
    const sourceRoot = path.dirname(repositoryRoot);
    const repositoriesDirectory = CORE_SETTINGS.workspace.repositoriesDirectory;
    if (path.basename(sourceRoot) !== repositoriesDirectory) {
      throw new Error(
        `Code Repository должен находиться в <workspace>/${repositoriesDirectory}/: ${repositoryRoot}`,
      );
    }
    const workspaceRoot = path.dirname(sourceRoot);
    const stat = await this.#lstatOrNull(workspaceRoot);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Workspace должен быть обычным каталогом: ${workspaceRoot}`);
    }
    return new Workspace(await fs.realpath(workspaceRoot));
  }

  async resolveCheckout(workspace, repository) {
    const candidate = workspace.checkoutPath(repository);
    const stat = await this.#lstatOrNull(candidate);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${candidate}`);
    }
    return new RepositoryCheckout(repository, await fs.realpath(candidate));
  }

  async #lstatOrNull(target) {
    try {
      return await fs.lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
}

/** Общий immutable workspace facade нового Core. */
export const workspace = Object.freeze(new WorkspaceResolver());
