/** @fileoverview Единый доменный результат установки или загрузки Plugin package. */

import path from "node:path";

import { PluginSource } from "./plugin-source.js";

const INSTALLATION_CONSTRUCTION = Symbol("PluginInstallation construction");

/** Immutable результат загрузки одного Plugin package. */
export class PluginInstallation {
  #loadedPlugin;
  #runtimeRoot;
  #source;

  constructor({ loadedPlugin, runtimeRoot, source } = {}, token) {
    const bundled = source instanceof PluginSource && source.kind === "bundled";
    if (
      token !== INSTALLATION_CONSTRUCTION ||
      !loadedPlugin ||
      typeof loadedPlugin.id !== "string" ||
      !(source instanceof PluginSource) ||
      (!bundled && (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot))) ||
      (bundled && runtimeRoot !== undefined)
    ) {
      throw new Error("PLUGIN_INSTALLATION_INVALID: используйте Plugin Manager");
    }
    this.#loadedPlugin = loadedPlugin;
    this.#runtimeRoot = runtimeRoot;
    this.#source = source;
    Object.freeze(this);
  }

  get declaration() {
    return `${this.#loadedPlugin.package.name}@${this.#loadedPlugin.package.version}`;
  }
  get id() { return this.#loadedPlugin.id; }
  get loadedPlugin() { return this.#loadedPlugin; }
  get runtimeRoot() { return this.#runtimeRoot; }
  get source() { return this.#source; }
  get version() { return this.#loadedPlugin.package.version; }
}

/** Создаёт проверенный installation внутри Plugin package boundary. */
export function createPluginInstallation(options) {
  return new PluginInstallation(options, INSTALLATION_CONSTRUCTION);
}
