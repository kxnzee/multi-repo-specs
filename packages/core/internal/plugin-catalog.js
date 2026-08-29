/** @fileoverview Доменный каталог доступных для инициализации Plugin packages. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

import { PluginSource } from "./plugin-source.js";

/** Завершает операцию стабильной ошибкой Plugin catalog. */
function invalid(message) {
  throw new Error(`PLUGIN_CATALOG_INVALID: ${message}`);
}

/** Immutable описание одного Plugin в каталоге поставки. */
export class PluginCatalogEntry {
  #id;
  #name;
  #source;

  constructor({ id, name, source } = {}) {
    if (typeof id !== "string" || !PLUGIN_PATTERNS.id.test(id)) {
      invalid(`некорректный plugin-id '${id ?? ""}'`);
    }
    if (typeof name !== "string" || !name.trim()) {
      invalid(`name для ${id} должен быть непустой строкой`);
    }
    if (!(source instanceof PluginSource)) {
      invalid(`source для ${id} должен быть PluginSource`);
    }
    this.#id = id;
    this.#name = name.trim();
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get source() { return this.#source; }
}

/** Стабильный Plugin registry только для init discovery. */
export class PluginCatalog {
  #entries;

  constructor(entries = []) {
    if (!Array.isArray(entries) || entries.some((entry) => !(entry instanceof PluginCatalogEntry))) {
      invalid("entries должен содержать PluginCatalogEntry");
    }
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(sorted.map(({ id }) => id)).size !== sorted.length) {
      invalid("entries содержит повторяющийся plugin-id");
    }
    this.#entries = Object.freeze(sorted);
    Object.freeze(this);
  }

  get entries() { return this.#entries; }

  require(pluginId) {
    const entry = this.#entries.find(({ id }) => id === pluginId);
    if (!entry) throw new Error(`PLUGIN_NOT_DISCOVERED: plugin-id '${pluginId}' не найден`);
    return entry;
  }

  select(pluginIds) {
    if (!Array.isArray(pluginIds)) invalid("pluginIds должен быть массивом");
    const selected = new Set(pluginIds);
    if (selected.size !== pluginIds.length) invalid("pluginIds содержит повторяющийся plugin-id");
    for (const pluginId of selected) this.require(pluginId);
    return Object.freeze(this.#entries.filter(({ id }) => selected.has(id)));
  }
}

/** Пустой каталог по умолчанию; distribution наполняет его в composition root. */
export const pluginCatalog = Object.freeze(new PluginCatalog());
