/** @fileoverview Координация Plugin installation, project declaration и portable lock. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { configuration } from "./configuration.js";
import { CORE_FILES, CORE_SERVICE_PATHS } from "./constants.js";
import { files } from "./files.js";
import { localPluginOverrides } from "./local-plugin-overrides.js";
import { locks } from "./lock.js";
import { pluginInstallers } from "./plugin-installer.js";
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
      invalid(`${CORE_SERVICE_PATHS.lockDirectory} содержит небезопасный segment`);
    }
  }
}

/** Immutable результат успешной установки и регистрации Plugin. */
export class PluginApplicationResult {
  #installation;
  #storeProject;

  constructor({ installation, storeProject }) {
    if (
      !installation ||
      !installation.record ||
      !(storeProject instanceof StoreProject) ||
      !storeProject.project.hasPlugin(installation.record.pluginId)
    ) {
      invalid("результат installation не согласован со StoreProject");
    }
    this.#installation = installation;
    this.#storeProject = storeProject;
    Object.freeze(this);
  }

  get installation() { return this.#installation; }
  get storeProject() { return this.#storeProject; }
}

/** Immutable результат удаления Plugin declaration и Store-local runtime. */
export class PluginRemovalResult {
  #pluginId;
  #removed;
  #runtimeRemoved;
  #storeProject;

  constructor({ pluginId, removed, runtimeRemoved, storeProject }) {
    if (
      typeof pluginId !== "string" ||
      typeof removed !== "boolean" ||
      typeof runtimeRemoved !== "boolean" ||
      !(storeProject instanceof StoreProject) ||
      (removed && storeProject.project.hasPlugin(pluginId))
    ) {
      invalid("результат removal не согласован со StoreProject");
    }
    this.#pluginId = pluginId;
    this.#removed = removed;
    this.#runtimeRemoved = runtimeRemoved;
    this.#storeProject = storeProject;
    Object.freeze(this);
  }

  get pluginId() { return this.#pluginId; }
  get removed() { return this.#removed; }
  get runtimeRemoved() { return this.#runtimeRemoved; }
  get storeProject() { return this.#storeProject; }
}

/** Application service безопасного изменения Plugin project state. */
export class PluginApplicationService {
  #configuration;
  #files;
  #installers;
  #localOverrides;
  #lock;
  #storeProjects;

  constructor({
    configurationService = configuration,
    fileService = files,
    installerService = pluginInstallers,
    localOverrideService = localPluginOverrides,
    lock = locks,
    storeProjectService = storeProjects,
  } = {}) {
    if (typeof configurationService?.serializeProject !== "function") {
      invalid("configurationService должен предоставлять serializeProject");
    }
    if (typeof fileService?.forRepository !== "function") {
      invalid("fileService должен предоставлять forRepository");
    }
    if (typeof installerService?.forStore !== "function") {
      invalid("installerService должен предоставлять forStore");
    }
    if (typeof localOverrideService?.forStore !== "function") {
      invalid("localOverrideService должен предоставлять forStore");
    }
    if (typeof lock?.run !== "function") invalid("lock должен предоставлять run");
    if (typeof storeProjectService?.load !== "function") {
      invalid("storeProjectService должен предоставлять load");
    }
    this.#configuration = configurationService;
    this.#files = fileService;
    this.#installers = installerService;
    this.#localOverrides = localOverrideService;
    this.#lock = lock;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  /** Устанавливает Plugin и только затем публикует его lock и project declaration. */
  async install(storeProject, pluginId, source) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    if (!(source instanceof PluginSource) || !source.installable) {
      invalid("требуется installable PluginSource");
    }
    await ensureLockDirectory(storeProject.root);
    return this.#lock.run(
      path.join(storeProject.root, CORE_SERVICE_PATHS.projectConfigLock),
      () => this.#installUnlocked(storeProject.root, pluginId, source),
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

  async #installUnlocked(root, pluginId, source) {
    const current = await this.#storeProjects.load(root);
    current.project.declarePlugin(pluginId, source.declaration);
    const projectSource = this.#configuration.serializeProject(current.project);
    const installation = await this.#installers.forStore(current.checkout).install(pluginId, source);
    if (
      !installation?.record ||
      installation.record.pluginId !== pluginId ||
      installation.record.source.spec !== source.declaration
    ) {
      invalid("Installer вернул несогласованный installation record");
    }
    if (source.developmentOnly) {
      await this.#localOverrides.forStore(current.checkout).set(pluginId, source);
    }
    await this.#files.forRepository(current.checkout).write(
      CORE_FILES.orchestratorConfig,
      projectSource,
    );
    return new PluginApplicationResult({ installation, storeProject: current });
  }

  async #removeUnlocked(root, pluginId) {
    const current = await this.#storeProjects.load(root);
    const declaration = current.project.pluginDeclaration(pluginId);
    const removed = current.project.removePlugin(pluginId);
    if (!removed) {
      return new PluginRemovalResult({
        pluginId,
        removed: false,
        runtimeRemoved: false,
        storeProject: current,
      });
    }
    const overrideStore = declaration.source === "local"
      ? this.#localOverrides.forStore(current.checkout)
      : null;
    if (overrideStore) await overrideStore.read();
    const runtimeRemoved = await this.#installers.forStore(current.checkout).remove(pluginId);
    if (overrideStore) await overrideStore.remove(pluginId);
    await this.#files.forRepository(current.checkout).write(
      CORE_FILES.orchestratorConfig,
      this.#configuration.serializeProject(current.project),
    );
    return new PluginRemovalResult({
      pluginId,
      removed: true,
      runtimeRemoved,
      storeProject: current,
    });
  }
}

/** Общий Plugin Application Service нового Core. */
export const pluginApplications = Object.freeze(new PluginApplicationService());
