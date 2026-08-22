/** @fileoverview Переносимая декларация Plugin в project config. */

import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";
import { PluginSource } from "./plugin-source.js";

/** Проверяет переносимую строку source из project config. */
function assertSource(source) {
  if (source === "local") return;
  let parsed;
  try {
    parsed = PluginSource.parse(source, { cwd: path.resolve("/") });
  } catch (error) {
    throw new Error(`PLUGIN_DECLARATION_INVALID: source: ${error.message}`, { cause: error });
  }
  if (parsed.declaration !== source || parsed.developmentOnly) {
    throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть переносимым");
  }
}

/** Immutable Plugin ID и его переносимый package source. */
export class PluginDeclaration {
  #id;
  #source;

  constructor({ id, source } = {}) {
    if (typeof id !== "string" || !CORE_PATTERNS.pluginId.test(id)) {
      throw new Error(`PLUGIN_DECLARATION_INVALID: некорректный plugin-id '${id ?? ""}'`);
    }
    if (typeof source !== "string" || !source) {
      throw new Error("PLUGIN_DECLARATION_INVALID: source должен быть непустой строкой");
    }
    assertSource(source);
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
