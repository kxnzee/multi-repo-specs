/** @fileoverview Переносимая декларация Plugin в project config. */

import { CORE_PATTERNS } from "./constants.js";

/** Immutable Plugin ID и его переносимый package source. */
export class PluginDeclaration {
  #id;
  #required;
  #source;

  constructor({ id, required = false, source } = {}) {
    if (typeof id !== "string" || !CORE_PATTERNS.pluginId.test(id)) {
      throw new Error(`PLUGIN_DECLARATION_INVALID: некорректный plugin-id '${id ?? ""}'`);
    }
    if (typeof source !== "string" || !source) {
      throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть непустой строкой");
    }
    if (/[\r\n\0]/.test(source)) {
      throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть однострочным");
    }
    if (typeof required !== "boolean") {
      throw new Error("PLUGIN_DECLARATION_INVALID: required должен быть boolean");
    }
    this.#id = id;
    this.#required = required;
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get required() { return this.#required; }
  get source() { return this.#source; }

  toConfig() {
    return Object.freeze({
      id: this.#id,
      source: this.#source,
      ...(this.#required ? { required: true } : {}),
    });
  }
}
