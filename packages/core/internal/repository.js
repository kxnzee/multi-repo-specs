/** @fileoverview Доменная модель Repository из проектного реестра. */

import { CORE_PATTERNS } from "./constants.js";
import { deepFreeze } from "./value.js";

const REPOSITORY_ROLES = new Set(["store", "code"]);

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

  constructor({ id, role, remote, defaultBranch, plugins = [] }) {
    if (typeof id !== "string" || id.length === 0) invalid("id обязателен");
    if (!REPOSITORY_ROLES.has(role)) invalid(`неизвестная role '${role}'`);
    if (typeof remote !== "string" || remote.length === 0) invalid(`remote ${id} обязателен`);
    if (typeof defaultBranch !== "string" || defaultBranch.length === 0) {
      invalid(`defaultBranch ${id} обязателен`);
    }
    if (!Array.isArray(plugins) || plugins.some((pluginId) => typeof pluginId !== "string")) {
      invalid(`plugins ${id} должен быть массивом ID`);
    }
    if (new Set(plugins).size !== plugins.length) {
      invalid(`plugins ${id} содержит повторяющийся ID`);
    }

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

  isStore() {
    return this.#role === "store";
  }

  isCode() {
    return this.#role === "code";
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
      plugins: [...this.#plugins],
    });
  }
}

/** Создаёт Repository через публичный функциональный фасад. */
export function createRepository(config) {
  return new Repository(config);
}
