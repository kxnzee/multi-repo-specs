/** @fileoverview Доменная модель Repository из проектного реестра. */

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { CORE_PATTERNS } from "./constants.js";
import { deepFreeze } from "./value.js";

const REPOSITORY_ROLES = new Set(Object.values(REPOSITORY_ROLE));

/** Завершает создание Repository стабильной доменной ошибкой. */
function invalid(message) {
  throw new Error(`REPOSITORY_INVALID: ${message}`);
}

/** Immutable Repository с принадлежащими ему Plugin bindings. */
export class Repository {
  #id;
  #role;
  #remote;
  #defaultBranch;
  #plugins;
  #description;
  #storeId;

  constructor({ id, role, remote, defaultBranch, description, storeId, plugins = [] }) {
    if (typeof id !== "string" || id.length === 0) invalid("id обязателен");
    if (!REPOSITORY_ROLES.has(role)) invalid(`неизвестная role '${role}'`);
    if ((role !== REPOSITORY_ROLE.store || remote !== undefined) && (typeof remote !== "string" || remote.length === 0)) invalid(`remote ${id} обязателен`);
    if ((role !== REPOSITORY_ROLE.store || defaultBranch !== undefined) && (typeof defaultBranch !== "string" || defaultBranch.length === 0)) {
      invalid(`defaultBranch ${id} обязателен`);
    }
    if (!Array.isArray(plugins) || plugins.some((pluginId) => typeof pluginId !== "string")) {
      invalid(`plugins ${id} должен быть массивом ID`);
    }
    if (new Set(plugins).size !== plugins.length) {
      invalid(`plugins ${id} содержит повторяющийся ID`);
    }

    if (description !== undefined && (typeof description !== "string" || description.trim().length === 0)) {
      invalid(`description ${id} должен быть непустой строкой`);
    }
    if (role === REPOSITORY_ROLE.specs) {
      if (!CORE_PATTERNS.id.test(id)) invalid("specs id должен быть lowercase kebab-case");
      if (typeof storeId !== "string" || !CORE_PATTERNS.id.test(storeId)) {
        invalid(`storeId ${id} обязателен для specs`);
      }
    } else if (storeId !== undefined) invalid("storeId допустим только для specs");
    this.#storeId = storeId;
    this.#description = description;
    this.#id = id;
    this.#role = role;
    this.#remote = remote;
    this.#defaultBranch = defaultBranch;
    this.#plugins = Object.freeze([...plugins]);
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get role() {
    return this.#role;
  }

  get remote() {
    return this.#remote;
  }

  get defaultBranch() {
    return this.#defaultBranch;
  }

  get plugins() {
    return this.#plugins;
  }

  get description() {
    return this.#description;
  }

  get storeId() { return this.#storeId; }

  isSpecs() { return this.#role === REPOSITORY_ROLE.specs; }

  isStore() {
    return this.#role === REPOSITORY_ROLE.store;
  }

  isCode() {
    return this.#role === REPOSITORY_ROLE.code;
  }

  hasPlugin(pluginId) {
    return this.#plugins.includes(pluginId);
  }

  matchesRemote(remote) {
    if (typeof remote !== "string") return false;
    const normalize = (value) => value.trim().replace(CORE_PATTERNS.trailingSlashes, "");
    return normalize(this.#remote) === normalize(remote);
  }

  connectPlugin(pluginId) {
    if (this.hasPlugin(pluginId)) return this;
    return new Repository({
      ...this.toConfig(),
      plugins: [...this.#plugins, pluginId].sort(),
    });
  }

  disconnectPlugin(pluginId) {
    if (!this.hasPlugin(pluginId)) return this;
    return new Repository({
      ...this.toConfig(),
      plugins: this.#plugins.filter((id) => id !== pluginId),
    });
  }

  toConfig() {
    return deepFreeze({
      id: this.#id,
      role: this.#role,
      remote: this.#remote,
      defaultBranch: this.#defaultBranch,
      ...(this.#description !== undefined ? { description: this.#description } : {}),
      ...(this.#storeId !== undefined ? { storeId: this.#storeId } : {}),
      plugins: [...this.#plugins],
    });
  }
}

/** Создаёт Repository через публичный функциональный фасад. */
export function createRepository(config) {
  return new Repository(config);
}
