/** @fileoverview Автоматический lifecycle standalone Extensions из Store composition. */

import process from "node:process";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { agentExtensions } from "./agent-extension-adapter.js";
import { bundledExtensions } from "./bundled-extension.js";
import { processes } from "./process.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

/** Wraps one native failure with its portable Extension target. */
function nativeFailure(extensionId, targetId, cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`EXTENSION_NATIVE_FAILED: ${extensionId} → ${targetId}: ${message}`, { cause });
}

/** Подключает выбранные standalone Extensions без отдельного CLI-фасада. */
export class ExtensionLifecycle {
  #adapter;
  #processes;
  #provider;
  #start;
  #storeProjects;

  constructor({
    agentAdapter = agentExtensions,
    bundledProvider = bundledExtensions,
    processService = processes,
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (!hasMethods(agentAdapter, ["invokeExtension", "preflight", "validateExtension"])) {
      throw new Error(
        "EXTENSION_LIFECYCLE_INVALID: требуется preflight/validateExtension/invokeExtension adapter",
      );
    }
    if (!hasMethods(bundledProvider, ["resolve"])) {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуется BundledExtensionProvider");
    }
    if (!hasMethods(processService, ["forRepository"])) {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуется ProcessService");
    }
    if (!hasMethods(storeProjectService, ["resolve"]) || typeof start !== "string") {
      throw new Error("EXTENSION_LIFECYCLE_INVALID: требуются StoreProjectService и start");
    }
    this.#adapter = agentAdapter;
    this.#processes = processService;
    this.#provider = bundledProvider;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  /** Проверяет Agent CLI и manifests всех выбранных Extensions до mutation. */
  async preflight() {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const context = this.#context(storeProject);
    const result = await this.#adapter.preflight(context);
    for (const declaration of storeProject.project.extensionDeclarations) {
      await this.#adapter.validateExtension(this.#resolveExtension(storeProject, declaration));
    }
    return result;
  }

  connectSelected() { return this.#invokeSelected("connect"); }
  statusSelected() { return this.#invokeSelected("status"); }
  disconnectSelected() { return this.#invokeSelected("disconnect"); }

  /** Проверяет все выбранные Extensions, не останавливаясь после независимой ошибки. */
  async diagnoseSelected() {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const context = this.#context(storeProject);
    const results = [];
    for (const declaration of storeProject.project.extensionDeclarations) {
      let extension;
      try {
        extension = this.#resolveExtension(storeProject, declaration);
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

  async #invokeSelected(operation) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const declarations = operation === "disconnect"
      ? [...storeProject.project.extensionDeclarations].reverse()
      : storeProject.project.extensionDeclarations;
    const context = this.#context(storeProject);
    const results = [];
    for (const declaration of declarations) {
      const extension = this.#resolveExtension(storeProject, declaration);
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

  #resolveExtension(storeProject, declaration) {
    const resolved = this.#provider.resolve(declaration);
    return Object.freeze({
      id: resolved.id,
      name: resolved.name,
      root: resolved.root,
      source: resolved.source,
      ...(resolved.manifests ? { manifests: resolved.manifests } : {}),
      target: Object.freeze({ id: storeProject.store.id, role: REPOSITORY_ROLE.store }),
    });
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
