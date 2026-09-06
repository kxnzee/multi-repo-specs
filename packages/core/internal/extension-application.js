/** @fileoverview Координация Extension Manager и Project registry. */

import { storeProjectMutations } from "./store-project-mutation.js";
import { StoreProject } from "./store-project.js";

/** Завершает operation стабильной ошибкой application boundary. */
function invalid(message) {
  throw new Error(`EXTENSION_APPLICATION_INVALID: ${message}`);
}

export class ExtensionApplicationService {
  #managers;
  #mutations;

  constructor({
    managerService,
    mutationService = storeProjectMutations,
  } = {}) {
    if (typeof managerService?.forStore !== "function") {
      invalid("managerService должен предоставлять forStore");
    }
    if (typeof mutationService?.run !== "function" || typeof mutationService?.write !== "function") {
      invalid("mutationService должен предоставлять run и write");
    }
    this.#managers = managerService;
    this.#mutations = mutationService;
    Object.freeze(this);
  }

  async install(storeProject, extensionId, source) {
    this.#assertProject(storeProject);
    return this.#mutations.run(storeProject.root, async (current) => {
      let initialized;
      await this.#managers.forStore(current.checkout).install(
        extensionId,
        source,
        async (extension) => {
          if (extension?.id !== extensionId) invalid("Extension Manager вернул другой ID");
          initialized = current.project.declareExtension(extensionId);
          await this.#writeProject(current);
        },
      );
      return Object.freeze({ initialized: Boolean(initialized) });
    }, { busyCode: "EXTENSION_APPLICATION_BUSY", corruptionCode: "EXTENSION_APPLICATION_INVALID" });
  }

  async remove(storeProject, extensionId, { beforeRemove = async () => {} } = {}) {
    this.#assertProject(storeProject);
    if (typeof beforeRemove !== "function") invalid("beforeRemove должен быть function");
    return this.#mutations.run(storeProject.root, async (current) => {
      if (!current.project.extensionDeclaration(extensionId)) {
        return Object.freeze({ removed: false });
      }
      const manager = this.#managers.forStore(current.checkout);
      await manager.prepareRemoval(extensionId);
      await beforeRemove();
      current.project.removeExtension(extensionId);
      await manager.remove(
        extensionId,
        () => this.#writeProject(current),
      );
      return Object.freeze({ removed: true });
    }, { busyCode: "EXTENSION_APPLICATION_BUSY", corruptionCode: "EXTENSION_APPLICATION_INVALID" });
  }

  #assertProject(storeProject) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
  }

  #writeProject(storeProject) {
    return this.#mutations.write(storeProject);
  }
}
