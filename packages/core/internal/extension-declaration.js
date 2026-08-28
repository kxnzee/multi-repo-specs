/** @fileoverview Переносимая декларация standalone Extension в Project config. */

import { CORE_PATTERNS } from "./constants.js";
import { hasExactKeys, isPlainObject } from "./value.js";

const FIELDS = Object.freeze(["id", "source"]);

/** Завершает создание стабильной ошибкой Extension declaration. */
function invalid(message) {
  throw new Error(`EXTENSION_DECLARATION_INVALID: ${message}`);
}

/** Immutable ID и versionless bundled source одного standalone Extension. */
export class ExtensionDeclaration {
  #id;
  #source;

  constructor(config = {}) {
    if (!isPlainObject(config)) invalid("declaration должна быть object");
    if (!hasExactKeys(config, FIELDS)) {
      invalid(`разрешены только поля ${FIELDS.join(", ")}`);
    }
    const { id, source } = config;
    if (typeof id !== "string" || !CORE_PATTERNS.pluginId.test(id)) {
      invalid(`некорректный extension-id '${id ?? ""}'`);
    }
    if (source !== `bundled:${id}`) {
      invalid(`source для ${id} должен быть bundled:${id}`);
    }
    this.#id = id;
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get source() { return this.#source; }

  toConfig() {
    return Object.freeze({ id: this.#id, source: this.#source });
  }
}
