/** @fileoverview Атомарное persistence Repository bindings из project config. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { configuration } from "./configuration.js";
import { CORE_FILES, CORE_SERVICE_PATHS } from "./constants.js";
import { files } from "./files.js";
import { locks } from "./lock.js";
import { StoreProject, storeProjects } from "./store-project.js";

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Безопасно создаёт Core-owned каталог блокировок внутри Store. */
async function ensureLockDirectory(root) {
  let current = root;
  for (const segment of CORE_SERVICE_PATHS.lockDirectory.split("/")) {
    current = path.join(current, segment);
    const existing = await lstatOrNull(current);
    if (!existing) {
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_BINDING_CORRUPTED: ${current} должен быть обычным каталогом`);
    }
  }
}

/** Immutable результат изменения одного Repository binding. */
export class PluginBindingChange {
  #changed;
  #output;
  #storeProject;

  constructor({ changed, output, storeProject }) {
    if (typeof changed !== "boolean" || !(storeProject instanceof StoreProject)) {
      throw new Error("PLUGIN_BINDING_RESULT_INVALID: требуются changed и StoreProject");
    }
    this.#changed = changed;
    this.#output = output;
    this.#storeProject = storeProject;
    Object.freeze(this);
  }

  get changed() { return this.#changed; }
  get output() { return this.#output; }
  get storeProject() { return this.#storeProject; }
}

/** Выполняет setup и сохраняет Core-owned binding одной fail-closed операцией. */
export class PluginBindingService {
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
    this.#configuration = configurationService;
    this.#files = fileService;
    this.#lock = lock;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async connect(storeProject, pluginId, repositoryId, operation) {
    if (!(storeProject instanceof StoreProject)) {
      throw new Error("PLUGIN_BINDING_INVALID: требуется StoreProject");
    }
    if (typeof operation !== "function") {
      throw new Error("PLUGIN_BINDING_INVALID: требуется connect operation");
    }
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => {
        const current = await this.#storeProjects.load(storeProject.root);
        current.project.requirePlugin(pluginId);
        current.project.requireRepository(repositoryId);
        if (current.project.isPluginConnected(pluginId, repositoryId)) {
          return new PluginBindingChange({ changed: false, output: "", storeProject: current });
        }
        const output = await operation(current);
        current.project.connectPlugin(pluginId, [repositoryId]);
        const source = this.#configuration.serializeProject(current.project);
        await this.#files.forRepository(current.checkout).write(
          CORE_FILES.orchestratorConfig,
          source,
        );
        return new PluginBindingChange({ changed: true, output, storeProject: current });
      },
      { busyCode: "PLUGIN_BINDING_BUSY" },
    );
  }
}

/** Общий Core facade Repository bindings. */
export const pluginBindings = Object.freeze(new PluginBindingService());
