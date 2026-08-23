/** @fileoverview Distribution-owned Plugin packages без Store-local materialization. */

import path from "node:path";

import { PluginCatalog, PluginCatalogEntry } from "./plugin-catalog.js";
import { pluginLoader } from "./plugin-loader.js";
import { PluginSource } from "./plugin-source.js";

const BUNDLED_INSTALLATION_CONSTRUCTION = Symbol("BundledPluginInstallation construction");

/** Завершает операцию стабильной ошибкой bundled provider. */
function invalid(message) {
  throw new Error(`BUNDLED_PLUGIN_INVALID: ${message}`);
}

/** Immutable declaration одного Plugin package из дистрибутива. */
export class BundledPluginPackage {
  #id;
  #name;
  #packageRoot;
  #source;
  #version;

  constructor({ id, name, packageName, packageRoot, version } = {}) {
    if (typeof packageRoot !== "string" || !path.isAbsolute(packageRoot)) {
      invalid("packageRoot должен быть абсолютным путём");
    }
    const source = PluginSource.bundled({ name: packageName, version });
    const catalogEntry = new PluginCatalogEntry({ id, name, source });
    this.#id = catalogEntry.id;
    this.#name = catalogEntry.name;
    this.#packageRoot = path.normalize(packageRoot);
    this.#source = source;
    this.#version = version;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get packageRoot() { return this.#packageRoot; }
  get source() { return this.#source; }
  get version() { return this.#version; }

  toCatalogEntry() {
    return new PluginCatalogEntry({ id: this.#id, name: this.#name, source: this.#source });
  }
}

/** Загруженный bundled Plugin с общим installation-shaped публичным контрактом. */
export class BundledPluginInstallation {
  #loadedPlugin;
  #source;

  constructor({ loadedPlugin, source } = {}, token) {
    if (
      token !== BUNDLED_INSTALLATION_CONSTRUCTION ||
      !loadedPlugin ||
      typeof loadedPlugin.id !== "string" ||
      !(source instanceof PluginSource) ||
      source.kind !== "bundled"
    ) {
      invalid("используйте BundledPluginProvider.install");
    }
    this.#loadedPlugin = loadedPlugin;
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#loadedPlugin.id; }
  get declaration() { return this.#source.declaration; }
  get version() { return this.#loadedPlugin.package.version; }
  get loadedPlugin() { return this.#loadedPlugin; }
  get packageRoot() { return this.#loadedPlugin.root; }
  get reused() { return true; }
  get source() { return this.#source; }
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
    return this.#packages.some((pluginPackage) => (
      pluginPackage.id === pluginId && pluginPackage.source.declaration === sourceDeclaration
    ));
  }

  async install(pluginId, source) {
    if (!(source instanceof PluginSource) || source.kind !== "bundled") {
      invalid("source должен быть bundled PluginSource");
    }
    const pluginPackage = this.#packages.find((candidate) => (
      candidate.id === pluginId && candidate.source.declaration === source.declaration
    ));
    if (!pluginPackage) {
      invalid(`${pluginId} с source ${source.declaration} не входит в дистрибутив`);
    }
    const loadedPlugin = await this.#loader.load({
      packageRoot: pluginPackage.packageRoot,
      pluginId,
    });
    if (
      `${loadedPlugin.package.name}@${loadedPlugin.package.version}` !== source.declaration ||
      loadedPlugin.package.version !== pluginPackage.version
    ) {
      invalid(`${pluginId}: package identity не совпадает с distribution declaration`);
    }
    return new BundledPluginInstallation(
      { loadedPlugin, source },
      BUNDLED_INSTALLATION_CONSTRUCTION,
    );
  }

  async resolve(declaration) {
    const pluginPackage = this.#packages.find((candidate) => (
      candidate.id === declaration?.id && candidate.source.declaration === declaration?.source
    ));
    if (!pluginPackage) {
      invalid(`${declaration?.id ?? ""} не входит в дистрибутив`);
    }
    return this.install(pluginPackage.id, pluginPackage.source);
  }
}

/** Пустой provider по умолчанию; distribution наполняет его в composition root. */
export const bundledPlugins = Object.freeze(new BundledPluginProvider());
