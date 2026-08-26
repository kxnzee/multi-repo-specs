/** @fileoverview Координация Plugin Manager и project declaration. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { agentIntegrations } from "./agent.js";
import { configuration } from "./configuration.js";
import { CORE_FILES, CORE_SERVICE_PATHS } from "./constants.js";
import { files } from "./files.js";
import { locks } from "./lock.js";
import { pluginManagers } from "./plugin-manager.js";
import { PluginSource } from "./plugin-source.js";
import { StoreProject, storeProjects } from "./store-project.js";

/** Завершает операцию стабильной ошибкой Plugin application service. */
function invalid(message, options) {
  throw new Error(`PLUGIN_APPLICATION_INVALID: ${message}`, options);
}

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Создаёт безопасный общий Core lock directory. */
async function ensureLockDirectory(root, corruptionCode = "PLUGIN_APPLICATION_INVALID") {
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
      throw new Error(
        `${corruptionCode}: ${CORE_SERVICE_PATHS.lockDirectory} содержит небезопасный segment`,
      );
    }
  }
}

/** Immutable результат успешной установки и регистрации Plugin. */
export class PluginApplicationResult {
  #initialized;

  constructor({ initialized }) {
    if (typeof initialized !== "boolean") invalid("initialized должен быть boolean");
    this.#initialized = initialized;
    Object.freeze(this);
  }

  get initialized() { return this.#initialized; }
}

/** Immutable результат удаления Plugin declaration. */
export class PluginRemovalResult {
  #cleanupPaths;
  #removed;

  constructor({ removed, cleanupPaths = [] }) {
    if (typeof removed !== "boolean") invalid("removed должен быть boolean");
    if (!Array.isArray(cleanupPaths) || cleanupPaths.some((value) => typeof value !== "string")) {
      invalid("cleanupPaths должен быть массивом строк");
    }
    this.#cleanupPaths = Object.freeze([...cleanupPaths]);
    this.#removed = removed;
    Object.freeze(this);
  }

  get cleanupPaths() { return this.#cleanupPaths; }
  get removed() { return this.#removed; }
}

/** Immutable результат изменения одного Repository binding. */
export class PluginBindingChange {
  #changed;
  #output;

  constructor({ changed, output }) {
    if (typeof changed !== "boolean") invalid("binding change требует changed");
    this.#changed = changed;
    this.#output = output;
    Object.freeze(this);
  }

  get changed() { return this.#changed; }
  get output() { return this.#output; }
}

/** Application service безопасного изменения Plugin project state. */
export class PluginApplicationService {
  #agents;
  #configuration;
  #files;
  #managers;
  #lock;
  #storeProjects;

  constructor({
    agentService = agentIntegrations,
    configurationService = configuration,
    fileService = files,
    managerService = pluginManagers,
    lock = locks,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof agentService?.resolve !== "function" ||
      typeof agentService?.install !== "function" ||
      typeof agentService?.remove !== "function"
    ) {
      invalid("agentService должен предоставлять resolve, install и remove");
    }
    if (typeof configurationService?.serializeProject !== "function") {
      invalid("configurationService должен предоставлять serializeProject");
    }
    if (typeof fileService?.forRepository !== "function") {
      invalid("fileService должен предоставлять forRepository");
    }
    if (typeof managerService?.forStore !== "function") {
      invalid("managerService должен предоставлять forStore");
    }
    if (typeof lock?.run !== "function") invalid("lock должен предоставлять run");
    if (typeof storeProjectService?.load !== "function") {
      invalid("storeProjectService должен предоставлять load");
    }
    this.#agents = agentService;
    this.#configuration = configurationService;
    this.#files = fileService;
    this.#managers = managerService;
    this.#lock = lock;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  /** Устанавливает Plugin и только затем публикует его lock и project declaration. */
  async install(storeProject, pluginId, source, { required } = {}) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!(source instanceof PluginSource)) {
      invalid("требуется PluginSource");
    }
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      () => this.#installUnlocked(storeProject.root, pluginId, source, required),
      { busyCode: "PLUGIN_APPLICATION_BUSY" },
    );
  }

  /** Synchronizes the exact required-by-Template set without removing Plugin packages. */
  async setRequiredPlugins(storeProject, pluginIds) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!Array.isArray(pluginIds)) invalid("pluginIds должен быть массивом");
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => {
        const current = await this.#storeProjects.load(storeProject.root);
        const changed = current.project.setRequiredPlugins(pluginIds);
        if (changed) await this.#writeProject(current);
        return changed;
      },
      { busyCode: "PLUGIN_APPLICATION_BUSY" },
    );
  }

  /** Удаляет только Plugin без Repository bindings и принадлежащий ему runtime. */
  async remove(storeProject, pluginId) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      () => this.#removeUnlocked(storeProject.root, pluginId),
      { busyCode: "PLUGIN_APPLICATION_BUSY" },
    );
  }

  /** Выполняет Plugin setup и публикует bindings одной project mutation. */
  async connectMany(storeProject, pluginId, repositoryIds, operation) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      invalid("repositoryIds должен быть непустым массивом");
    }
    if (typeof operation !== "function") invalid("требуется connect operation");
    const selectedIds = [...new Set(repositoryIds)];
    await ensureLockDirectory(storeProject.root, "PLUGIN_BINDING_CORRUPTED");
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
            changes.push(new PluginBindingChange({ changed: false, output: "" }));
            continue;
          }
          const output = await operation(current, repositoryId);
          connectedIds.push(repositoryId);
          changes.push(new PluginBindingChange({ changed: true, output }));
        }
        if (connectedIds.length > 0) {
          current.project.connectPlugin(pluginId, connectedIds);
          await this.#writeProject(current);
        }
        return Object.freeze(changes);
      },
      { busyCode: "PLUGIN_BINDING_BUSY" },
    );
  }

  /** Удаляет один Repository binding без вызова Plugin cleanup. */
  async disconnect(storeProject, pluginId, repositoryId) {
    const [change] = await this.disconnectMany(storeProject, pluginId, [repositoryId]);
    return change;
  }

  /** Удаляет несколько Repository bindings одной project mutation. */
  async disconnectMany(storeProject, pluginId, repositoryIds) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      invalid("repositoryIds должен быть непустым массивом");
    }
    const selectedIds = [...new Set(repositoryIds)];
    await ensureLockDirectory(storeProject.root, "PLUGIN_BINDING_CORRUPTED");
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      async () => {
        const current = await this.#storeProjects.load(storeProject.root);
        current.project.requirePlugin(pluginId);
        for (const repositoryId of selectedIds) current.project.requireRepository(repositoryId);
        const changes = selectedIds.map((repositoryId) => new PluginBindingChange({
          changed: current.project.disconnectPlugin(pluginId, repositoryId),
          output: "",
        }));
        if (changes.some(({ changed }) => changed)) await this.#writeProject(current);
        return Object.freeze(changes);
      },
      { busyCode: "PLUGIN_BINDING_BUSY" },
    );
  }

  async #installUnlocked(root, pluginId, source, required) {
    const current = await this.#storeProjects.load(root);
    const previousProjectSource = this.#configuration.serializeProject(current.project);
    let result;
    await this.#managers.forStore(current.checkout).install(
      pluginId,
      source,
      async (installation) => {
        if (
          !installation ||
          installation.id !== pluginId ||
          !(installation.source instanceof PluginSource) ||
          typeof installation.declaration !== "string"
        ) {
          invalid("Plugin Manager вернул несогласованный installation");
        }
        const initialized = current.project.declarePlugin(
          pluginId,
          installation.declaration,
          { required },
        );
        const integration = await this.#agents.resolve(current, installation.loadedPlugin);
        await this.#writeProject(current);
        try {
          if (integration) await this.#agents.install(current, integration);
        } catch (error) {
          await this.#writeProjectSource(current, previousProjectSource);
          throw error;
        }
        result = new PluginApplicationResult({ initialized });
      },
    );
    if (!(result instanceof PluginApplicationResult)) {
      invalid("Plugin Manager не опубликовал installation");
    }
    return result;
  }

  async #removeUnlocked(root, pluginId) {
    const current = await this.#storeProjects.load(root);
    const declaration = current.project.pluginDeclaration(pluginId);
    if (!declaration) return new PluginRemovalResult({ removed: false });
    const manager = this.#managers.forStore(current.checkout);
    const installation = await manager.resolve(declaration);
    const integration = await this.#agents.resolve(current, installation.loadedPlugin);
    const previousProjectSource = this.#configuration.serializeProject(current.project);
    let cleanupPaths = [];
    current.project.removePlugin(pluginId);
    await manager.remove(
      pluginId,
      async () => {
        await this.#writeProject(current);
        try {
          if (integration) {
            const cleanup = await this.#agents.remove(current, integration);
            cleanupPaths = cleanup?.cleanupPaths ?? [];
          }
        } catch (error) {
          await this.#writeProjectSource(current, previousProjectSource);
          throw error;
        }
      },
    );
    return new PluginRemovalResult({
      cleanupPaths,
      removed: true,
    });
  }

  async #writeProject(storeProject) {
    await this.#writeProjectSource(
      storeProject,
      this.#configuration.serializeProject(storeProject.project),
    );
  }

  async #writeProjectSource(storeProject, source) {
    await this.#files.forRepository(storeProject.checkout).write(
      CORE_FILES.orchestratorConfig,
      source,
    );
  }
}

/** Общий Plugin Application Service нового Core. */
export const pluginApplications = Object.freeze(new PluginApplicationService());
