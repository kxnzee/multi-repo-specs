/** @fileoverview Explicit user-level lifecycle for one distribution-owned Agent gateway. */

import { execa } from "execa";

import { ScopedProcess } from "./process.js";
import { hasMethods } from "./value.js";

const USER_SCOPE = "user";
const RECOVERABLE_STATUS = /AGENT_EXTENSION_STATUS_(?:DISABLED|MISSING|SCOPE_MISSING):/u;

/** Coordinates one globally available Agent Extension without Project or Store state. */
export class AgentGatewayService {
  #adapter;
  #agents;
  #executor;
  #extensionId;
  #extensions;
  #start;

  constructor({
    agentProvider,
    executor = execa,
    extensionId,
    extensionProvider,
    start,
  } = {}) {
    if (
      !agentProvider?.catalog ||
      !Array.isArray(agentProvider.catalog.entries) ||
      !hasMethods(agentProvider, ["resolve"]) ||
      !hasMethods(agentProvider.adapter, ["invokeExtension", "preflight", "validateExtension"])
    ) {
      throw new Error("AGENT_GATEWAY_INVALID: требуется полный bundled Agent provider");
    }
    if (!hasMethods(extensionProvider, ["resolve"])) {
      throw new Error("AGENT_GATEWAY_INVALID: требуется bundled Extension provider");
    }
    if (typeof extensionId !== "string" || extensionId.length === 0) {
      throw new Error("AGENT_GATEWAY_INVALID: extensionId обязателен");
    }
    if (typeof start !== "string" || typeof executor !== "function") {
      throw new Error("AGENT_GATEWAY_INVALID: требуются start и executor");
    }
    this.#adapter = agentProvider.adapter;
    this.#agents = agentProvider;
    this.#executor = executor;
    this.#extensionId = extensionId;
    this.#extensions = extensionProvider;
    this.#start = start;
    Object.freeze(this);
  }

  /** Lists exact Agent choices supported by the bundled gateway. */
  listAgents() {
    return Object.freeze(this.#agents.catalog.entries.map(({ id, name }) => (
      Object.freeze({ id, name })
    )));
  }

  /** Installs/enables and verifies the gateway in explicit user scope. */
  async setup(agentId) {
    const runtime = this.#runtime(agentId);
    await this.#adapter.preflight(runtime.context);
    await this.#adapter.validateExtension(runtime.extension);
    try {
      await this.#adapter.invokeExtension(runtime.context, runtime.extension, {
        operation: "status",
        scope: USER_SCOPE,
      });
      return this.#result(agentId, "ready");
    } catch (error) {
      if (!RECOVERABLE_STATUS.test(error?.message ?? "")) throw error;
    }
    await this.#adapter.invokeExtension(runtime.context, runtime.extension, {
      operation: "connect",
      scope: USER_SCOPE,
    });
    await this.#adapter.invokeExtension(runtime.context, runtime.extension, {
      operation: "status",
      scope: USER_SCOPE,
    });
    return this.#result(agentId, "ready");
  }

  /** Verifies that the user-level gateway is currently enabled. */
  async status(agentId) {
    const runtime = this.#runtime(agentId);
    await this.#adapter.invokeExtension(runtime.context, runtime.extension, {
      operation: "status",
      scope: USER_SCOPE,
    });
    return this.#result(agentId, "ready");
  }

  /** Removes the user-level gateway through the native Agent CLI. */
  async remove(agentId) {
    const runtime = this.#runtime(agentId);
    await this.#adapter.invokeExtension(runtime.context, runtime.extension, {
      operation: "remove",
      scope: USER_SCOPE,
    });
    return this.#result(agentId, "removed");
  }

  #result(agentId, status) {
    return Object.freeze({
      agent_id: agentId,
      extension_id: this.#extensionId,
      scope: USER_SCOPE,
      status,
    });
  }

  #runtime(agentId) {
    const agent = this.#agents.resolve(agentId);
    const extensionPackage = this.#extensions.resolve({
      id: this.#extensionId,
      source: `bundled:${this.#extensionId}`,
    });
    return Object.freeze({
      context: Object.freeze({
        agent,
        process: new ScopedProcess(this.#start, this.#executor),
      }),
      extension: Object.freeze({
        id: extensionPackage.id,
        name: extensionPackage.name,
        root: extensionPackage.root,
        source: extensionPackage.source,
        target: Object.freeze({ id: USER_SCOPE, role: "agent" }),
      }),
    });
  }
}
