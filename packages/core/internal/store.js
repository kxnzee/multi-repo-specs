/** @fileoverview Доменная модель Store identity. */

import { deepFreeze } from "./value.js";

/** Завершает создание Store стабильной доменной ошибкой. */
function invalid(message) {
  throw new Error(`STORE_INVALID: ${message}`);
}

/** Store identity из Core-owned metadata. */
export class Store {
  #id;
  #remote;

  constructor({ id, remote }) {
    if (typeof id !== "string" || id.length === 0) invalid("id обязателен");
    if (remote !== undefined && (typeof remote !== "string" || remote.length === 0)) {
      invalid("remote должен быть непустой строкой");
    }
    this.#id = id;
    this.#remote = remote;
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get remote() {
    return this.#remote;
  }

  matches(repository, sameRemote = (left, right) => left === right) {
    return repository.role === "store" &&
      repository.id === this.#id &&
      this.#remote !== undefined &&
      sameRemote(repository.remote, this.#remote);
  }

  assertMatches(repository, sameRemote) {
    if (!this.matches(repository, sameRemote)) {
      throw new Error("STORE_IDENTITY_MISMATCH: Store metadata не совпадает с role: store");
    }
  }

  identity() {
    return deepFreeze({ id: this.#id, remote: this.#remote });
  }
}

/** Создаёт Store через публичный функциональный фасад. */
export function createStore(metadata) {
  return new Store(metadata);
}
