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
    const [change] = await this.connectMany(
      storeProject,
      pluginId,
      [repositoryId],
      (current) => operation(current),
    );
    return change;
  }

  async connectMany(storeProject, pluginId, repositoryIds, operation) {
    if (!(storeProject instanceof StoreProject)) {
      throw new Error("PLUGIN_BINDING_INVALID: требуется StoreProject");
    }
    if (!Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      throw new Error("PLUGIN_BINDING_INVALID: repositoryIds должен быть непустым массивом");
    }
    if (typeof operation !== "function") {
      throw new Error("PLUGIN_BINDING_INVALID: требуется connect operation");
    }
    const selectedIds = [...new Set(repositoryIds)];
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => {
        const current = await this.#storeProjects.load(storeProject.root);
        current.project.requirePlugin(pluginId);
        for (const repositoryId of selectedIds) current.project.requireRepository(repositoryId);
        const changes = [];
        const connectedIds = [];
        for (const repositoryId of selectedIds) {
          if (current.project.isPluginConnected(pluginId, repositoryId)) {
            changes.push(new PluginBindingChange({
              changed: false,
              output: "",
              storeProject: current,
            }));
            continue;
          }
          const output = await operation(current, repositoryId);
          connectedIds.push(repositoryId);
          changes.push(new PluginBindingChange({ changed: true, output, storeProject: current }));
        }
        if (connectedIds.length > 0) {
          current.project.connectPlugin(pluginId, connectedIds);
          const source = this.#configuration.serializeProject(current.project);
          await this.#files.forRepository(current.checkout).write(
            CORE_FILES.orchestratorConfig,
            source,
          );
        }
        return Object.freeze(changes);
      },
      { busyCode: "PLUGIN_BINDING_BUSY" },
    );
  }
}

/** Общий Core facade Repository bindings. */
export const pluginBindings = Object.freeze(new PluginBindingService());
