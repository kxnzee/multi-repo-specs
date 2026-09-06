/** @fileoverview Автоматический lifecycle standalone Extensions из Store composition. */

import process from "node:process";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { agentExtensions } from "./agent-extension-adapter.js";
import { processes } from "./process.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

/** Wraps one native failure with its portable Extension target. */
function nativeFailure(extensionId, targetId, cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`EXTENSION_NATIVE_FAILED: ${extensionId} → ${targetId}: ${message}`, { cause });
}

/** Выполняет общий и адресный lifecycle standalone Extensions. */
export class ExtensionLifecycle {
  #adapter;
  #processes;
  #managers;
  #start;
  #storeProjects;

  constructor({
    agentAdapter = agentExtensions,
    managerService,
    processService = processes,
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (!hasMethods(agentAdapter, ["invokeExtension", "preflight", "validateExtension"])) {
      throw new Error(
        "EXTENSION_LIFECYCLE_INVALID: требуется preflight/validateExtension/invokeExtension adapter",
      );
    }
    if (!hasMethods(managerService, ["forStore"])) {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуется ExtensionManagerService");
    }
    if (!hasMethods(processService, ["forRepository"])) {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуется ProcessService");
    }
    if (!hasMethods(storeProjectService, ["resolve"]) || typeof start !== "string") {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуются StoreProjectService и start");
    }
    this.#adapter = agentAdapter;
    this.#processes = processService;
    this.#managers = managerService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  /** Проверяет Agent CLI и manifests всех выбранных Extensions до mutation. */
  async preflight() {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const context = this.#context(storeProject);
    const result = await this.#adapter.preflight(context);
    const manager = this.#managers.forStore(storeProject.checkout);
    for (const declaration of storeProject.project.extensionDeclarations) {
      await this.#adapter.validateExtension(
        await this.#resolveExtension(storeProject, manager, declaration),
        { agentId: storeProject.project.agent.id },
      );
    }
    return result;
  }

  connectSelected() { return this.#invokeSelected("connect"); }
  statusSelected() { return this.#invokeSelected("status"); }
  disconnectSelected() { return this.#invokeSelected("disconnect"); }

  connect(extensionId) { return this.#invokeOne(extensionId, "connect", { preflight: true }); }
  disconnect(extensionId) { return this.#invokeOne(extensionId, "disconnect"); }
  remove(extensionId) { return this.#invokeOne(extensionId, "remove"); }

  /** Проверяет все выбранные Extensions, не останавливаясь после независимой ошибки. */
  diagnoseSelected() { return this.statuses(); }

  /** Возвращает диагностический status всех или одной объявленной Extension. */
  async statuses({ extensionId } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const context = this.#context(storeProject);
    const manager = this.#managers.forStore(storeProject.checkout);
    const declarations = this.#declarations(storeProject, extensionId);
    const results = [];
    for (const declaration of declarations) {
      let extension;
      try {
        extension = await this.#resolveExtension(storeProject, manager, declaration);
        const output = await this.#invoke(context, extension, "status");
        results.push(Object.freeze({
          extensionId: extension.id,
          targetId: extension.target.id,
          state: "ready",
          output: typeof output === "string" ? output : "",
        }));
      } catch (cause) {
        const extensionId = extension?.id ?? declaration.id;
        const targetId = extension?.target.id ?? storeProject.store.id;
        const message = nativeFailure(extensionId, targetId, cause).message;
        results.push(Object.freeze({
          extensionId,
          targetId,
          state: "unavailable",
          output: message,
        }));
      }
    }
    return Object.freeze(results);
  }

  async #invokeOne(extensionId, operation, { preflight = false } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const [declaration] = this.#declarations(storeProject, extensionId);
    const context = this.#context(storeProject);
    const extension = await this.#resolveExtension(
      storeProject,
      this.#managers.forStore(storeProject.checkout),
      declaration,
    );
    try {
      if (preflight) {
        await this.#adapter.preflight(context);
        await this.#adapter.validateExtension(extension, { agentId: storeProject.project.agent.id });
      }
      return await this.#invoke(context, extension, operation);
    } catch (cause) {
      throw nativeFailure(extension.id, storeProject.store.id, cause);
    }
  }

  async #invokeSelected(operation) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const declarations = operation === "disconnect"
      ? [...storeProject.project.extensionDeclarations].reverse()
      : storeProject.project.extensionDeclarations;
    const context = this.#context(storeProject);
    const manager = this.#managers.forStore(storeProject.checkout);
    const results = [];
    for (const declaration of declarations) {
      const extension = await this.#resolveExtension(storeProject, manager, declaration);
      try {
        results.push(await this.#invoke(context, extension, operation));
      } catch (cause) {
        throw nativeFailure(extension.id, extension.target.id, cause);
      }
    }
    return Object.freeze(results);
  }

  #invoke(context, extension, operation) {
    return this.#adapter.invokeExtension(context, extension, Object.freeze({ operation }));
  }

  async #resolveExtension(storeProject, manager, declaration) {
    const resolved = await manager.resolve(declaration);
    return Object.freeze({
      id: resolved.id,
      name: resolved.name,
      root: resolved.root,
      source: resolved.source,
      ...(resolved.manifests ? { manifests: resolved.manifests } : {}),
      target: Object.freeze({ id: storeProject.store.id, role: REPOSITORY_ROLE.store }),
    });
  }

  #declarations(storeProject, extensionId) {
    if (extensionId === undefined) return storeProject.project.extensionDeclarations;
    if (typeof extensionId !== "string" || !extensionId) {
      throw new Error("EXTENSION_ID_INVALID: extension-id должен быть непустой строкой");
    }
    const declaration = storeProject.project.extensionDeclaration(extensionId);
    if (!declaration) throw new Error(`EXTENSION_NOT_DECLARED: ${extensionId}`);
    return Object.freeze([declaration]);
  }

  #context(storeProject) {
    const agent = storeProject.project.agent;
    if (!agent || typeof agent.id !== "string") {
      throw new Error("EXTENSION_AGENT_INVALID: Store должен содержать один Agent");
    }
    return Object.freeze({
      agent,
      process: this.#processes.forRepository(storeProject.checkout),
    });
  }
}
