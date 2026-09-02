/** @fileoverview Distribution-owned Plugin packages без Store-local materialization. */

import path from "node:path";

import { PluginCatalog, PluginCatalogEntry } from "./plugin-catalog.js";
import { createPluginInstallation } from "./plugin-installation.js";
import { pluginLoader } from "./plugin-loader.js";
import { PluginSource } from "./plugin-source.js";

/** Завершает операцию стабильной ошибкой bundled provider. */
function invalid(message) {
  throw new Error(`BUNDLED_PLUGIN_INVALID: ${message}`);
}

/** Immutable declaration одного Plugin package из дистрибутива. */
export class BundledPluginPackage {
  #catalogEntry;
  #packageRoot;

  constructor({ id, name, packageName, packageRoot, recommended = false, version } = {}) {
    if (typeof packageRoot !== "string" || !path.isAbsolute(packageRoot)) {
      invalid("packageRoot должен быть абсолютным путём");
    }
    const source = PluginSource.bundled({ name: packageName, version });
    this.#catalogEntry = new PluginCatalogEntry({ id, name, recommended, source });
    this.#packageRoot = path.normalize(packageRoot);
    Object.freeze(this);
  }

  get id() { return this.#catalogEntry.id; }
  get name() { return this.#catalogEntry.name; }
  get packageRoot() { return this.#packageRoot; }
  get source() { return this.#catalogEntry.source; }

  toCatalogEntry() {
    return this.#catalogEntry;
  }
}

/** Loader и catalog distribution-owned Plugins без знания их ID в Core. */
export class BundledPluginProvider {
  #catalog;
  #loader;
  #packages;

  constructor(packages = [], { loader = pluginLoader } = {}) {
    if (
      !Array.isArray(packages) ||
      packages.some((pluginPackage) => !(pluginPackage instanceof BundledPluginPackage))
    ) {
      invalid("packages должен содержать BundledPluginPackage");
    }
    if (typeof loader?.load !== "function") invalid("loader должен предоставлять load");
    const sorted = [...packages].sort((left, right) => left.id.localeCompare(right.id));
    this.#catalog = new PluginCatalog(sorted.map((pluginPackage) => (
      pluginPackage.toCatalogEntry()
    )));
    this.#loader = loader;
    this.#packages = Object.freeze(sorted);
    Object.freeze(this);
  }

  get catalog() { return this.#catalog; }

  has(pluginId, sourceDeclaration) {
    return this.#find(pluginId, sourceDeclaration) !== undefined;
  }

  async install(pluginId, source) {
    if (!(source instanceof PluginSource) || source.kind !== "bundled") {
      invalid("source должен быть bundled PluginSource");
    }
    const pluginPackage = this.#find(pluginId, source.declaration);
    if (!pluginPackage) {
      invalid(`${pluginId} с source ${source.declaration} не входит в дистрибутив`);
    }
    return this.#load(pluginPackage, source);
  }

  async resolve(declaration) {
    const pluginPackage = this.#find(declaration?.id, declaration?.source);
    if (!pluginPackage) {
      invalid(`${declaration?.id ?? ""} не входит в дистрибутив`);
    }
    return this.#load(pluginPackage, pluginPackage.source);
  }

  #find(pluginId, sourceDeclaration) {
    return this.#packages.find((candidate) => (
      candidate.id === pluginId && candidate.source.declaration === sourceDeclaration
    ));
  }

  async #load(pluginPackage, source) {
    const loadedPlugin = await this.#loader.load({
      packageRoot: pluginPackage.packageRoot,
      pluginId: pluginPackage.id,
    });
    if (`${loadedPlugin.package.name}@${loadedPlugin.package.version}` !== source.declaration) {
      invalid(`${pluginPackage.id}: package identity не совпадает с distribution declaration`);
    }
    return createPluginInstallation({ loadedPlugin, source });
  }
}

/** Пустой provider по умолчанию; distribution наполняет его в composition root. */
export const bundledPlugins = Object.freeze(new BundledPluginProvider());
