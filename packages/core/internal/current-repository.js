/** @fileoverview Read-only identity Repository, из которого вызвана команда. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { coreState } from "./core-state.js";
import { git } from "./git.js";
import { StoreProject } from "./store-project.js";
import { workspace } from "./workspace.js";

/** Возвращает lstat либо null для отсутствующего пути. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Находит ближайший Git root без выполнения команды в недоверенном cwd. */
async function findGitRoot(start) {
  let candidate = path.resolve(start);
  const initial = await lstatOrNull(candidate);
  if (!initial) return null;
  if (!initial.isDirectory()) candidate = path.dirname(candidate);
  while (true) {
    if (await lstatOrNull(path.join(candidate, ".git"))) return fs.realpath(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

/** Определяет текущий Store или Code Repository по проверенному Project registry. */
export class CurrentRepositoryService {
  #git;
  #state;
  #workspace;

  constructor({ gitService = git, stateService = coreState, workspaceService = workspace } = {}) {
    this.#git = gitService;
    this.#state = stateService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async resolve({ start = process.cwd(), storeProject } = {}) {
    if (!(storeProject instanceof StoreProject)) {
      throw new Error("CURRENT_REPOSITORY_INVALID: требуется StoreProject");
    }
    const repositoryRoot = await findGitRoot(start);
    if (!repositoryRoot) return null;
    if (repositoryRoot === storeProject.root) {
      return Object.freeze({
        id: storeProject.store.id,
        role: "store",
        path: storeProject.root,
      });
    }
    const storedWorkspace = (await this.#state.forStore(storeProject.checkout).read()).workspace;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot: storeProject.root,
      storeId: storeProject.store.id,
      storedWorkspace,
    }).catch((error) => {
      if (error.code === "WORKSPACE_UNRESOLVED") return null;
      throw error;
    });
    if (!workspaceModel) return null;
    for (const repository of storeProject.project.codeRepositories) {
      const checkout = await this.#workspace.resolveCheckout(workspaceModel, repository)
        .catch((error) => {
          if (error.code === "REPOSITORY_CHECKOUT_UNAVAILABLE") return null;
          throw error;
        });
      if (!checkout || checkout.root !== repositoryRoot) continue;
      await this.#git.forRepository(checkout).assertIdentity();
      return Object.freeze({ id: repository.id, role: "code", path: checkout.root });
    }
    return null;
  }
}

/** Общий read-only resolver текущего Repository. */
export const currentRepositories = Object.freeze(new CurrentRepositoryService());
