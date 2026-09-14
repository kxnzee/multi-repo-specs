/** @fileoverview Переносимая декларация standalone Extension в Project config. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

/** Завершает создание стабильной ошибкой Extension declaration. */
function invalid(message) {
  throw new Error(`EXTENSION_DECLARATION_INVALID: ${message}`);
}

/** Immutable standalone Extension ID из Project registry. */
export class ExtensionDeclaration {
  #id;

  constructor(id) {
    if (typeof id !== "string" || !PLUGIN_PATTERNS.id.test(id)) {
      invalid(`некорректный extension-id '${id ?? ""}'`);
    }
    this.#id = id;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  toConfig() { return this.#id; }
}
