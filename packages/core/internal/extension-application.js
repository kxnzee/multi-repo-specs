/** @fileoverview Координация Extension Manager и Project registry. */

import path from "node:path";

import { configuration } from "./configuration.js";
import { CORE_FILES, CORE_SERVICE_PATHS } from "./constants.js";
import { ensureDirectory } from "./fs.js";
import { files } from "./files.js";
import { locks } from "./lock.js";
import { StoreProject, storeProjects } from "./store-project.js";

/** Завершает operation стабильной ошибкой application boundary. */
function invalid(message) {
  throw new Error(`EXTENSION_APPLICATION_INVALID: ${message}`);
}

/** Создаёт Core-owned lock directory. */
async function ensureLockDirectory(root) {
  let current = root;
  for (const segment of CORE_SERVICE_PATHS.lockDirectory.split("/")) {
    current = path.join(current, segment);
    const stat = await ensureDirectory(current, { mode: 0o700 });
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("lock directory небезопасен");
  }
}

export class ExtensionApplicationService {
  #configuration;
  #files;
  #lock;
  #managers;
  #storeProjects;

  constructor({
    configurationService = configuration,
    fileService = files,
    lock = locks,
    managerService,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof configurationService?.serializeProject !== "function" ||
      typeof fileService?.forRepository !== "function" ||
      typeof lock?.run !== "function" ||
      typeof managerService?.forStore !== "function" ||
      typeof storeProjectService?.load !== "function"
    ) {
      invalid("требуются configuration, files, lock, manager и Store Project services");
    }
    this.#configuration = configurationService;
    this.#files = fileService;
    this.#lock = lock;
    this.#managers = managerService;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async install(storeProject, extensionId, source) {
    this.#assertProject(storeProject);
    return this.#change(storeProject.root, async (current) => {
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
    });
  }

  async remove(storeProject, extensionId, { beforeRemove = async () => {} } = {}) {
    this.#assertProject(storeProject);
    if (typeof beforeRemove !== "function") invalid("beforeRemove должен быть function");
    return this.#change(storeProject.root, async (current) => {
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
    });
  }

  async #change(root, operation) {
    await ensureLockDirectory(root);
    return this.#lock.run(
      path.join(root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => operation(await this.#storeProjects.load(root)),
      { busyCode: "EXTENSION_APPLICATION_BUSY" },
    );
  }

  #assertProject(storeProject) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
  }

  #writeProject(storeProject) {
    return this.#files.forRepository(storeProject.checkout).write(
      CORE_FILES.orchestratorConfig,
      this.#configuration.serializeProject(storeProject.project),
    );
  }
}
