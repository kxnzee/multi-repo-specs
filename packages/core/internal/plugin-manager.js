/** @fileoverview Plugin-specific adapter над общим npm package supply. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

import { bundledPlugins } from "./bundled-plugin.js";
import { createPluginInstallation } from "./plugin-installation.js";
import { pluginLoader } from "./plugin-loader.js";
import { packageSupplies } from "./package-supply.js";
import { PluginDeclaration } from "./plugin-declaration.js";
import { PluginSource } from "./plugin-source.js";

/** Завершает operation стабильной ошибкой Plugin Manager. */
function invalid(message, options) {
  throw new Error(`PLUGIN_MANAGER_INVALID: ${message}`, options);
}

/** Разрешает Plugin contract, не реализуя npm lifecycle повторно. */
export class StorePluginManager {
  #bundled;
  #checkout;
  #loader;
  #supply;

  constructor(storeCheckout, {
    bundledProvider = bundledPlugins,
    loader = pluginLoader,
    supplyService = packageSupplies,
  } = {}) {
    if (
      typeof bundledProvider?.has !== "function" ||
      typeof bundledProvider?.install !== "function" ||
      typeof loader?.load !== "function" ||
      typeof supplyService?.forStore !== "function"
    ) {
      invalid("требуются bundled provider, loader и package supply");
    }
    this.#bundled = bundledProvider;
    this.#checkout = storeCheckout;
    this.#loader = loader;
    this.#supply = supplyService.forStore(storeCheckout);
    Object.freeze(this);
  }

  async install(pluginId, source, publish = async () => {}) {
    this.#assertInput(pluginId, source);
    if (typeof publish !== "function") invalid("publish должен быть function");
    if (source.kind === "bundled") {
      const installation = await this.#bundled.install(pluginId, source);
      await publish(installation);
      return installation;
    }
    if (this.#bundled.has(pluginId)) {
      invalid(`${pluginId}: встроенный Plugin нельзя заменить через --from`);
    }
    return this.#supply.install({
      id: pluginId,
      kind: "plugins",
      source: source.installSpec,
      validate: async (packageRoot) => createPluginInstallation({
        loadedPlugin: await this.#loader.load({ packageRoot, pluginId }),
        runtimeRoot: packageRoot,
        source,
      }),
      publish,
    });
  }

  async resolve(declaration) {
    if (!(declaration instanceof PluginDeclaration)) invalid("требуется PluginDeclaration");
    if (this.#bundled.has(declaration.id)) return this.#bundled.resolve(declaration);
    const resolved = await this.#supply.resolve("plugins", declaration.id);
    const loadedPlugin = await this.#loader.load({
      packageRoot: resolved.packageRoot,
      pluginId: declaration.id,
    });
    return createPluginInstallation({
      loadedPlugin,
      runtimeRoot: resolved.packageRoot,
      source: PluginSource.parse(
        `${loadedPlugin.package.name}@${loadedPlugin.package.version}`,
        { cwd: this.#checkout.root },
      ),
    });
  }

  async remove(pluginId, publish = async () => {}) {
    if (typeof pluginId !== "string" || !PLUGIN_PATTERNS.id.test(pluginId)) {
      invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
    }
    if (this.#bundled.has(pluginId)) {
      await publish();
      return false;
    }
    return this.#supply.remove("plugins", pluginId, publish);
  }

  #assertInput(pluginId, source) {
    if (typeof pluginId !== "string" || !PLUGIN_PATTERNS.id.test(pluginId)) {
      invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
    }
    if (!(source instanceof PluginSource)) invalid("требуется PluginSource");
  }
}

export class PluginManagerService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  forStore(storeCheckout) {
    return new StorePluginManager(storeCheckout, this.#dependencies);
  }
}

export const pluginManagers = Object.freeze(new PluginManagerService());
