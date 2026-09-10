/** @fileoverview Переносимая декларация Plugin в project config. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

/** Immutable Plugin ID из Project registry. */
export class PluginDeclaration {
  #id;

  constructor(id) {
    if (typeof id !== "string" || !PLUGIN_PATTERNS.id.test(id)) {
      throw new Error(`PLUGIN_DECLARATION_INVALID: некорректный plugin-id '${id ?? ""}'`);
    }
    this.#id = id;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  toConfig() { return this.#id; }
}
