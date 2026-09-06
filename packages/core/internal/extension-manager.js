/** @fileoverview Extension-specific adapter над общим npm package supply. */

import { EXTENSION_ID_PATTERN } from "@openspec-orch/extension-sdk";

import { bundledExtensions, NpmExtensionPackage } from "./bundled-extension.js";
import { ExtensionDeclaration } from "./extension-declaration.js";
import { packageSupplies } from "./package-supply.js";

/** Завершает operation стабильной ошибкой manager boundary. */
function invalid(message) {
  throw new Error(`EXTENSION_MANAGER_INVALID: ${message}`);
}

export class StoreExtensionManager {
  #agentIds;
  #bundled;
  #supply;

  constructor(storeCheckout, {
    agentIds = [],
    bundledProvider = bundledExtensions,
    supplyService = packageSupplies,
  } = {}) {
    if (
      !Array.isArray(agentIds) ||
      typeof bundledProvider?.has !== "function" ||
      typeof bundledProvider?.resolve !== "function" ||
      typeof supplyService?.forStore !== "function"
    ) {
      invalid("требуются agentIds, bundled provider и package supply");
    }
    this.#agentIds = Object.freeze([...agentIds]);
    this.#bundled = bundledProvider;
    this.#supply = supplyService.forStore(storeCheckout);
    Object.freeze(this);
  }

  async install(extensionId, source, publish = async () => {}) {
    this.#assertId(extensionId);
    if (typeof publish !== "function") invalid("publish должен быть function");
    if (source === undefined) {
      const extension = this.#bundled.resolve({ id: extensionId });
      await publish(extension);
      return extension;
    }
    if (this.#bundled.has(extensionId)) {
      invalid(`${extensionId}: встроенную Extension нельзя заменить через --from`);
    }
    if (typeof source !== "string" || !source) invalid("source должен быть непустой строкой");
    return this.#supply.install({
      id: extensionId,
      kind: "extensions",
      source,
      validate: (packageRoot) => NpmExtensionPackage.load(packageRoot, {
        agentIds: this.#agentIds,
        expectedId: extensionId,
      }),
      publish,
    });
  }

  async resolve(declaration) {
    if (!(declaration instanceof ExtensionDeclaration)) invalid("требуется ExtensionDeclaration");
    if (this.#bundled.has(declaration.id)) return this.#bundled.resolve(declaration);
    const resolved = await this.#supply.resolve("extensions", declaration.id);
    return NpmExtensionPackage.load(resolved.packageRoot, {
      agentIds: this.#agentIds,
      expectedId: declaration.id,
    });
  }

  /** Восстанавливает npm runtime перед native cleanup, если он отсутствует после checkout. */
  async prepareRemoval(extensionId) {
    this.#assertId(extensionId);
    if (this.#bundled.has(extensionId)) return;
    try {
      await this.#supply.resolve("extensions", extensionId);
    } catch (error) {
      if (error?.code !== "PACKAGE_RUNTIME_UNAVAILABLE") throw error;
      await this.#supply.sync();
    }
  }

  async remove(extensionId, publish = async () => {}) {
    this.#assertId(extensionId);
    if (this.#bundled.has(extensionId)) {
      await publish();
      return false;
    }
    return this.#supply.remove("extensions", extensionId, publish);
  }

  #assertId(extensionId) {
    if (typeof extensionId !== "string" || !EXTENSION_ID_PATTERN.test(extensionId)) {
      invalid(`некорректный extension-id '${extensionId ?? ""}'`);
    }
  }
}

export class ExtensionManagerService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  forStore(storeCheckout) {
    return new StoreExtensionManager(storeCheckout, this.#dependencies);
  }
}
