/** @fileoverview Координация Plugin Manager и project declaration. */

import { pluginManagers } from "./plugin-manager.js";
import { PluginSource } from "./plugin-source.js";
import { storeProjectMutations } from "./store-project-mutation.js";
import { StoreProject } from "./store-project.js";

/** Завершает операцию стабильной ошибкой Plugin application service. */
function invalid(message, options) {
  throw new Error(`PLUGIN_APPLICATION_INVALID: ${message}`, options);
}

/** Immutable результат успешной установки и регистрации Plugin. */
export class PluginApplicationResult {
  constructor({ initialized }) {
    if (typeof initialized !== "boolean") invalid("initialized должен быть boolean");
    this.initialized = initialized;
    Object.freeze(this);
  }
}

/** Immutable результат удаления Plugin declaration. */
export class PluginRemovalResult {
  constructor({ removed }) {
    if (typeof removed !== "boolean") invalid("removed должен быть boolean");
    this.removed = removed;
    Object.freeze(this);
  }
}

/** Immutable результат изменения одного Repository binding. */
export class PluginBindingChange {
  constructor({ changed, output }) {
    if (typeof changed !== "boolean") invalid("binding change требует changed");
    this.changed = changed;
    this.output = output;
    Object.freeze(this);
  }
}

/** Application service безопасного изменения Plugin project state. */
export class PluginApplicationService {
  #managers;
  #mutations;

  constructor({
    managerService = pluginManagers,
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

  /** Устанавливает Plugin и только затем публикует его lock и project declaration. */
  async install(storeProject, pluginId, source) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!(source instanceof PluginSource)) {
      invalid("требуется PluginSource");
    }
    return this.#mutations.run(
      storeProject.root,
      (current) => this.#installUnlocked(current, pluginId, source),
      { busyCode: "PLUGIN_APPLICATION_BUSY", corruptionCode: "PLUGIN_APPLICATION_INVALID" },
    );
  }

  /** Удаляет только Plugin без Repository bindings и принадлежащий ему runtime. */
  async remove(storeProject, pluginId) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    return this.#mutations.run(
      storeProject.root,
      (current) => this.#removeUnlocked(current, pluginId),
      { busyCode: "PLUGIN_APPLICATION_BUSY", corruptionCode: "PLUGIN_APPLICATION_INVALID" },
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
    return this.#mutations.run(
      storeProject.root,
      async (current) => {
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
      { busyCode: "PLUGIN_BINDING_BUSY", corruptionCode: "PLUGIN_BINDING_CORRUPTED" },
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
    return this.#mutations.run(
      storeProject.root,
      async (current) => {
        current.project.requirePlugin(pluginId);
        for (const repositoryId of selectedIds) current.project.requireRepository(repositoryId);
        const changes = selectedIds.map((repositoryId) => new PluginBindingChange({
          changed: current.project.disconnectPlugin(pluginId, repositoryId),
          output: "",
        }));
        if (changes.some(({ changed }) => changed)) await this.#writeProject(current);
        return Object.freeze(changes);
      },
      { busyCode: "PLUGIN_BINDING_BUSY", corruptionCode: "PLUGIN_BINDING_CORRUPTED" },
    );
  }

  async #installUnlocked(current, pluginId, source) {
    let result;
    await this.#managers.forStore(current.checkout).install(
      pluginId,
      source,
      async (installation) => {
        if (
          !installation ||
          installation.id !== pluginId ||
          !(installation.source instanceof PluginSource)
        ) {
          invalid("Plugin Manager вернул несогласованный installation");
        }
        const initialized = current.project.declarePlugin(pluginId);
        await this.#writeProject(current);
        result = new PluginApplicationResult({ initialized });
      },
    );
    if (!(result instanceof PluginApplicationResult)) {
      invalid("Plugin Manager не опубликовал installation");
    }
    return result;
  }

  async #removeUnlocked(current, pluginId) {
    const declaration = current.project.pluginDeclaration(pluginId);
    if (!declaration) return new PluginRemovalResult({ removed: false });
    const manager = this.#managers.forStore(current.checkout);
    current.project.removePlugin(pluginId);
    await manager.remove(
      pluginId,
      () => this.#writeProject(current),
    );
    return new PluginRemovalResult({ removed: true });
  }

  async #writeProject(storeProject) {
    await this.#mutations.write(storeProject);
  }
}

/** Общий Plugin Application Service нового Core. */
export const pluginApplications = Object.freeze(new PluginApplicationService());
