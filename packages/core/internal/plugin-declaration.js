/** @fileoverview Переносимая декларация Plugin в project config. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

import { hasExactKeys } from "./value.js";

/** Immutable Plugin ID и его переносимый package source. */
export class PluginDeclaration {
  #id;
  #source;

  constructor(config = {}) {
    if (!hasExactKeys(config, ["id", "source"])) {
      throw new Error("PLUGIN_DECLARATION_INVALID: разрешены только поля id и source");
    }
    const { id, source } = config;
    if (typeof id !== "string" || !PLUGIN_PATTERNS.id.test(id)) {
      throw new Error(`PLUGIN_DECLARATION_INVALID: некорректный plugin-id '${id ?? ""}'`);
    }
    if (typeof source !== "string" || !source) {
      throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть непустой строкой");
    }
    if (/[\r\n\0]/.test(source)) {
      throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть однострочным");
    }
    this.#id = id;
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get source() { return this.#source; }

  toConfig() {
    return Object.freeze({
      id: this.#id,
      source: this.#source,
    });
  }
}
