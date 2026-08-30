/** @fileoverview Generic router для distribution-owned Agent Extension adapters. */

import path from "node:path";

import { hasMethods } from "./value.js";

const OPERATIONS = new Set(["connect", "disconnect", "remove", "status"]);

/** Завершает проверку стабильной ошибкой Agent Adapter. */
function invalid(message) {
  throw new Error(`AGENT_EXTENSION_INVALID: ${message}`);
}

/** Проверяет структурный contract distribution-owned Agent adapter. */
export function isAgentExtensionAdapter(adapter) {
  return hasMethods(adapter, [
    "adaptOpenSpecPack", "invokeExtension", "preflight", "validateExtension",
  ]);
}

/** Проверяет provider adapter одного Agent. */
function adapterEntry(entry) {
  if (
    !entry?.definition ||
    typeof entry.definition.id !== "string" ||
    !isAgentExtensionAdapter(entry.adapter)
  ) {
    invalid(
      "provider должен содержать definition и " +
        "adaptOpenSpecPack/preflight/validateExtension/invokeExtension",
    );
  }
  return Object.freeze({ adapter: entry.adapter, definition: entry.definition });
}

/** Маршрутизирует generic Core request в adapter выбранного Agent. */
export class AgentExtensionAdapter {
  #providers;

  constructor(entries = []) {
    if (!Array.isArray(entries)) invalid("providers должен быть массивом");
    const providers = entries.map(adapterEntry);
    if (new Set(providers.map(({ definition }) => definition.id)).size !== providers.length) {
      invalid("provider Agent ID не должны повторяться");
    }
    this.#providers = new Map(providers.map((entry) => [entry.definition.id, entry]));
    Object.freeze(this);
  }

  /** Проверяет доступность native CLI выбранного Agent до mutation. */
  preflight(context) {
    const provider = this.#provider(context);
    return provider.adapter.preflight(this.#context(context, provider.definition));
  }

  /** Передаёт adaptation upstream OpenSpec pack adapter выбранного Agent. */
  adaptOpenSpecPack(context) {
    const provider = this.#provider(context, { requireProcess: false });
    if (typeof context.targetRoot !== "string" || !path.isAbsolute(context.targetRoot)) {
      invalid("adaptOpenSpecPack требует абсолютный targetRoot");
    }
    return provider.adapter.adaptOpenSpecPack(Object.freeze({
      agent: provider.definition,
      targetRoot: context.targetRoot,
    }));
  }

  /** Проверяет payload относительно manifests всех Agent текущей поставки. */
  async validateExtension(extension, { ownerId } = {}) {
    this.#assertExtension(extension);
    const nativeId = ownerId === undefined ? extension.id : `${ownerId}-${extension.id}`;
    for (const { adapter, definition } of this.#providers.values()) {
      await adapter.validateExtension(extension, definition, { nativeId });
    }
  }

  /** Передаёт одну Extension operation adapter выбранного Agent. */
  async invokeExtension(context, extension, request) {
    this.#assertExtension(extension);
    if (
      !OPERATIONS.has(request?.operation) ||
      (request.scope !== undefined && request.scope !== "user") ||
      (request.ownerId !== undefined && (
        typeof request.ownerId !== "string" || request.ownerId.trim().length === 0
      ))
    ) {
      invalid(
        "требуется поддерживаемая operation; scope может быть только user; " +
          "ownerId должен быть непустой строкой",
      );
    }
    const provider = this.#provider(context);
    return provider.adapter.invokeExtension(
      this.#context(context, provider.definition),
      extension,
      request,
    );
  }

  #assertExtension(extension) {
    if (
      !extension ||
      typeof extension.id !== "string" ||
      typeof extension.root !== "string" ||
      !path.isAbsolute(extension.root)
    ) {
      invalid("Extension должен содержать ID и абсолютный runtime root");
    }
  }

  #context(context, definition) {
    return Object.freeze({ agent: definition, process: context.process });
  }

  #provider(context, { requireProcess = true } = {}) {
    if (
      typeof context?.agent?.id !== "string" ||
      (requireProcess && typeof context.process?.run !== "function")
    ) {
      invalid("context должен предоставлять Agent и требуемый scoped process");
    }
    const provider = this.#providers.get(context.agent.id);
    if (!provider) throw new Error(`AGENT_EXTENSION_UNSUPPORTED: ${context.agent.id}`);
    return provider;
  }
}

/** Пустой router по умолчанию; distribution наполняет его из agents/. */
export const agentExtensions = Object.freeze(new AgentExtensionAdapter());
