/** @fileoverview Общая атомарная mutation граница Store Project. */

import path from "node:path";

import { configuration } from "./configuration.js";
import { CORE_FILES, CORE_SERVICE_PATHS } from "./constants.js";
import { files } from "./files.js";
import { ensureDirectory } from "./fs.js";
import { locks } from "./lock.js";
import { storeProjects } from "./store-project.js";

/** Координирует lock, повторную загрузку и публикацию одного Store Project. */
export class StoreProjectMutationService {
  #configuration;
  #files;
  #lock;
  #storeProjects;

  constructor({
    configurationService = configuration,
    fileService = files,
    lock = locks,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof configurationService?.serializeProject !== "function" ||
      typeof fileService?.forRepository !== "function" ||
      typeof lock?.run !== "function" ||
      typeof storeProjectService?.load !== "function"
    ) {
      throw new Error("STORE_PROJECT_MUTATION_INVALID: требуются configuration, files, lock и Store Project");
    }
    this.#configuration = configurationService;
    this.#files = fileService;
    this.#lock = lock;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async run(root, operation, {
    busyCode,
    corruptionCode = "STORE_PROJECT_MUTATION_INVALID",
  } = {}) {
    if (typeof root !== "string" || typeof operation !== "function" || typeof busyCode !== "string") {
      throw new Error("STORE_PROJECT_MUTATION_INVALID: требуются root, operation и busyCode");
    }
    let current = root;
    for (const segment of CORE_SERVICE_PATHS.lockDirectory.split("/")) {
      current = path.join(current, segment);
      const stat = await ensureDirectory(current, { mode: 0o700 });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(
          `${corruptionCode}: ${CORE_SERVICE_PATHS.lockDirectory} содержит небезопасный segment`,
        );
      }
    }
    return this.#lock.run(
      path.join(root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => operation(await this.#storeProjects.load(root)),
      { busyCode },
    );
  }

  write(storeProject) {
    return this.#files.forRepository(storeProject.checkout).write(
      CORE_FILES.orchestratorConfig,
      this.#configuration.serializeProject(storeProject.project),
    );
  }
}

export const storeProjectMutations = Object.freeze(new StoreProjectMutationService());
