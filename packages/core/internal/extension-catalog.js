/** @fileoverview Каталог standalone Agent Extensions из поставки Orchestrator. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

/** Завершает операцию стабильной ошибкой Extension catalog. */
function invalid(message) {
  throw new Error(`EXTENSION_CATALOG_INVALID: ${message}`);
}

/** Immutable описание одного Extension, доступного при init. */
export class ExtensionCatalogEntry {
  #id;
  #name;
  #source;

  constructor({ id, name, source } = {}) {
    if (typeof id !== "string" || !PLUGIN_PATTERNS.id.test(id)) {
      invalid(`некорректный extension-id '${id ?? ""}'`);
    }
    if (typeof name !== "string" || !name.trim()) {
      invalid(`name для ${id} должен быть непустой строкой`);
    }
    if (source !== `bundled:${id}`) {
      invalid(`source для ${id} должен быть bundled:${id}`);
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

/** Стабильно отсортированный каталог встроенных Extensions. */
export class ExtensionCatalog {
  #entries;

  constructor(entries = []) {
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => !(entry instanceof ExtensionCatalogEntry))
    ) {
      invalid("entries должен содержать ExtensionCatalogEntry");
    }
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(sorted.map(({ id }) => id)).size !== sorted.length) {
      invalid("entries содержит повторяющийся extension-id");
    }
    this.#entries = Object.freeze(sorted);
    Object.freeze(this);
  }

  get entries() { return this.#entries; }

  require(extensionId) {
    const entry = this.#entries.find(({ id }) => id === extensionId);
    if (!entry) {
      throw new Error(`EXTENSION_NOT_DISCOVERED: extension-id '${extensionId}' не найден`);
    }
    return entry;
  }

  select(extensionIds) {
    if (!Array.isArray(extensionIds)) invalid("extensionIds должен быть массивом");
    const selected = new Set(extensionIds);
    if (selected.size !== extensionIds.length) {
      invalid("extensionIds содержит повторяющийся extension-id");
    }
    return Object.freeze(extensionIds.map((extensionId) => this.require(extensionId)));
  }
}

/** Пустой каталог по умолчанию; distribution наполняет его в composition root. */
export const extensionCatalog = Object.freeze(new ExtensionCatalog());
