/** @fileoverview Автоматический lifecycle standalone Extensions из Store composition. */

import process from "node:process";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { agentExtensions } from "./agent-extension-adapter.js";
import { coreState } from "./core-state.js";
import { workspace } from "./workspace.js";
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
  #state;
  #workspace;

  constructor({
    agentAdapter = agentExtensions,
    managerService,
    processService = processes,
    start = process.cwd(),
    storeProjectService = storeProjects,
    stateService = coreState,
    workspaceService = workspace,
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
    this.#state = stateService;
    this.#workspace = workspaceService;
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
    const context = await this.#context(storeProject);
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

  connectSelected(options) { return this.#invokeSelected("connect", options); }
  statusSelected(options) { return this.#invokeSelected("status", options); }
  disconnectSelected() { return this.#invokeSelected("disconnect"); }

  connect(extensionId) { return this.#invokeOne(extensionId, "connect", { preflight: true }); }
  disconnect(extensionId) { return this.#invokeOne(extensionId, "disconnect"); }
  remove(extensionId) { return this.#invokeOne(extensionId, "remove"); }

  /** Проверяет все выбранные Extensions, не останавливаясь после независимой ошибки. */
  diagnoseSelected() { return this.statuses(); }

  /** Diagnoses each selected Extension target independently. */
  async statuses({ extensionId } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const manager = this.#managers.forStore(storeProject.checkout);
    const results = [];
    for (const declaration of this.#declarations(storeProject, extensionId)) {
      let resolved;
      try {
        resolved = await manager.resolve(declaration);
      } catch (cause) {
        results.push(this.#statusFailure(declaration.id, storeProject.store.id, cause));
        continue;
      }
      for (const repository of this.#targets(storeProject, resolved)) {
        try {
          const output = await this.#invokeTarget(storeProject, resolved, repository, "status");
          results.push(Object.freeze({ extensionId: resolved.id, targetId: repository.id,
            state: "ready", output: typeof output === "string" ? output : "" }));
        } catch (cause) {
          results.push(this.#statusFailure(resolved.id, repository.id, cause));
        }
      }
    }
    return Object.freeze(results);
  }

  #statusFailure(extensionId, targetId, cause) {
    return Object.freeze({ extensionId, targetId, state: "unavailable",
      output: cause.message?.startsWith("EXTENSION_NATIVE_FAILED:")
        ? cause.message : nativeFailure(extensionId, targetId, cause).message });
  }

  async #invokeOne(extensionId, operation, { preflight = false } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const [declaration] = this.#declarations(storeProject, extensionId);
    const resolved = await this.#managers.forStore(storeProject.checkout).resolve(declaration);
    const targets = this.#targets(storeProject, resolved);
    if (preflight) {
      await this.#adapter.preflight(await this.#context(storeProject));
      await this.#adapter.validateExtension(resolved, { agentId: storeProject.project.agent.id });
    }
    const results = await this.#invokeTargets(storeProject, resolved, targets, operation);
    return results.length === 1 ? results[0] : Object.freeze(results);
  }

  async #invokeSelected(operation, { workspace: requestedWorkspace } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const declarations = operation === "disconnect"
      ? [...storeProject.project.extensionDeclarations].reverse()
      : storeProject.project.extensionDeclarations;
    const manager = this.#managers.forStore(storeProject.checkout);
    const results = [];
    for (const declaration of declarations) {
      const resolved = await manager.resolve(declaration);
      results.push(...await this.#invokeTargets(
        storeProject, resolved, this.#targets(storeProject, resolved), operation, requestedWorkspace,
      ));
    }
    return Object.freeze(results);
  }

  async #invokeTargets(storeProject, resolved, targets, operation, requestedWorkspace) {
    const ordered = ["disconnect", "remove"].includes(operation) ? [...targets].reverse() : targets;
    const results = [];
    for (const [index, repository] of ordered.entries()) {
      // Native uninstall can be global (Qwen); disable other workspaces first.
      const action = operation === "remove" && index < ordered.length - 1 ? "disconnect" : operation;
      results.push(await this.#invokeTarget(storeProject, resolved, repository, action, requestedWorkspace));
    }
    return results;
  }

  async #invokeTarget(storeProject, resolved, repository, operation, requestedWorkspace) {
    try {
      return await this.#adapter.invokeExtension(
        await this.#context(storeProject, repository, requestedWorkspace),
        Object.freeze({ id: resolved.id, name: resolved.name, root: resolved.root,
          source: resolved.source, manifests: resolved.manifests, target: Object.freeze({ id: repository.id, role: repository.role }) }),
        Object.freeze({ operation }),
      );
    } catch (cause) {
      throw nativeFailure(resolved.id, repository.id, cause);
    }
  }

  #targets(storeProject, resolved) {
    const roles = resolved.targets ?? [REPOSITORY_ROLE.store];
    return [
      ...(roles.includes(REPOSITORY_ROLE.store)
        ? [{ id: storeProject.store.id, role: REPOSITORY_ROLE.store }] : []),
      ...(roles.includes(REPOSITORY_ROLE.code) ? storeProject.project.codeRepositories : []),
    ];
  }

  async #resolveExtension(storeProject, manager, declaration) {
    const resolved = await manager.resolve(declaration);
    return Object.freeze({ id: resolved.id, name: resolved.name, root: resolved.root,
          source: resolved.source, manifests: resolved.manifests, target: Object.freeze({
      id: storeProject.store.id, role: REPOSITORY_ROLE.store,
    }) });
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

  async #context(storeProject, repository = { role: REPOSITORY_ROLE.store }, requestedWorkspace) {
    const agent = storeProject.project.agent;
    if (!agent || typeof agent.id !== "string") {
      throw new Error("EXTENSION_AGENT_INVALID: Store должен содержать один Agent");
    }
    let checkout = storeProject.checkout;
    if (repository.role === REPOSITORY_ROLE.code) {
      const storedWorkspace = (await this.#state.forStore(storeProject.checkout).read()).workspace;
      const model = await this.#workspace.resolve({
        storeRoot: storeProject.root, storeId: storeProject.store.id, storedWorkspace, requestedWorkspace,
      });
      checkout = await this.#workspace.resolveCheckout(model, repository);
    }
    return Object.freeze({
      agent,
      process: this.#processes.forRepository(checkout),
    });
  }
}
