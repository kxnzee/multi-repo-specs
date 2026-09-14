/** @fileoverview Доменная цель инициализации ещё не зарегистрированного Store. */

import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";

/** Канонический локальный Store root до появления полной Repository identity. */
export class StoreTarget {
  #id;
  #root;

  constructor(id, root) {
    if (typeof id !== "string" || !CORE_PATTERNS.id.test(id)) {
      throw new Error(`STORE_TARGET_INVALID: некорректный Store ID '${id ?? ""}'`);
    }
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new Error(`STORE_TARGET_INVALID: root должен быть абсолютным путём: ${root}`);
    }
    this.#id = id;
    this.#root = path.normalize(root);
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get root() {
    return this.#root;
  }

  get role() {
    return "store";
  }
}
