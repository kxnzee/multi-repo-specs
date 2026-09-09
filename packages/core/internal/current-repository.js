/** @fileoverview Read-only identity Repository, из которого вызвана команда. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { coreState } from "./core-state.js";
import { lstatOrNull } from "./fs.js";
import { isContainedPath } from "./path.js";
import { StoreProject } from "./store-project.js";
import { workspace } from "./workspace.js";

/** Определяет текущий Store или Code Repository по проверенному Project registry. */
export class CurrentRepositoryService {
  #state;
  #workspace;

  constructor({ stateService = coreState, workspaceService = workspace } = {}) {
    this.#state = stateService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async resolve({ start = process.cwd(), storeProject } = {}) {
    if (!(storeProject instanceof StoreProject)) {
      throw new Error("CURRENT_REPOSITORY_INVALID: требуется StoreProject");
    }
    const stat = await lstatOrNull(path.resolve(start));
    if (!stat) return null;
    const currentPath = await fs.realpath(path.resolve(start));
    if (isContainedPath(storeProject.root, currentPath, { allowRoot: true })) {
      return Object.freeze({
        id: storeProject.store.id,
        role: REPOSITORY_ROLE.store,
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
      if (!checkout || !isContainedPath(checkout.root, currentPath, { allowRoot: true })) continue;
      return Object.freeze({ id: repository.id, role: REPOSITORY_ROLE.code, path: checkout.root });
    }
    return null;
  }
}

/** Общий read-only resolver текущего Repository. */
export const currentRepositories = Object.freeze(new CurrentRepositoryService());
