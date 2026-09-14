/** @fileoverview Distribution-owned Project Template packages and catalog. */

import { PLUGIN_PATTERNS } from "@openspec-orch/plugin-sdk";

import { CORE_PATTERNS } from "./constants.js";
import { loadTemplateDefinition } from "./template.js";

/** Завершает проверку bundled Template стабильной ошибкой. */
function invalid(message, options) {
  throw new Error(`BUNDLED_TEMPLATE_INVALID: ${message}`, options);
}

/** Проверяет минимальный duck-typed contract Template provider на composition boundaries. */
export function isBundledTemplateProvider(provider) {
  return typeof provider?.defaultId === "string" &&
    Array.isArray(provider?.catalog?.entries) &&
    typeof provider?.resolve === "function";
}

/** Immutable описание Project Template для init selection. */
export class TemplateCatalogEntry {
  constructor({ id, name, requiredExtensions = [] } = {}) {
    if (typeof id !== "string" || !CORE_PATTERNS.id.test(id)) {
      invalid(`некорректный template-id '${id ?? ""}'`);
    }
    if (typeof name !== "string" || !name.trim()) {
      invalid(`name для ${id} должен быть непустой строкой`);
    }
    if (
      !Array.isArray(requiredExtensions) ||
      requiredExtensions.some((extensionId) => (
        typeof extensionId !== "string" || !PLUGIN_PATTERNS.id.test(extensionId)
      )) ||
      new Set(requiredExtensions).size !== requiredExtensions.length
    ) {
      invalid(`requiredExtensions для ${id} должен содержать уникальные Extension IDs`);
    }
    this.id = id;
    this.name = name.trim();
    this.requiredExtensions = Object.freeze([...requiredExtensions]);
    Object.freeze(this);
  }
}

/** Стабильно отсортированный каталог встроенных Project Templates. */
export class TemplateCatalog {
  #entries;

  constructor(entries = []) {
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => !(entry instanceof TemplateCatalogEntry))
    ) {
      invalid("entries должен содержать TemplateCatalogEntry");
    }
    const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(sorted.map(({ id }) => id)).size !== sorted.length) {
      invalid("entries содержит повторяющийся template-id");
    }
    this.#entries = Object.freeze(sorted);
    Object.freeze(this);
  }

  get entries() { return this.#entries; }

  requiredExtensionsFor(templateId) {
    return this.#entries.find(({ id }) => id === templateId)?.requiredExtensions ?? [];
  }
}

/** Проверенный package одного templates/<id>. */
export class BundledTemplatePackage {
  #catalogEntry;
  #root;

  constructor({ catalogEntry, root } = {}) {
    if (!(catalogEntry instanceof TemplateCatalogEntry) || typeof root !== "string") {
      invalid("constructor требует TemplateCatalogEntry и root");
    }
    this.#catalogEntry = catalogEntry;
    this.#root = root;
    Object.freeze(this);
  }

  static async load(root, { expectedId } = {}) {
    let loaded;
    try {
      loaded = await loadTemplateDefinition(root);
    } catch (cause) {
      invalid(cause.message, { cause });
    }
    const { descriptor, root: canonicalRoot } = loaded;
    if (expectedId !== undefined && descriptor.id !== expectedId) {
      invalid(`identity '${descriptor.id}' не совпадает с каталогом '${expectedId}'`);
    }
    return new BundledTemplatePackage({
      catalogEntry: new TemplateCatalogEntry({
        id: descriptor.id,
        name: descriptor.name,
        requiredExtensions: descriptor.requires?.extensions ?? [],
      }),
      root: canonicalRoot,
    });
  }

  get id() { return this.#catalogEntry.id; }
  get name() { return this.#catalogEntry.name; }
  get requiredExtensions() { return this.#catalogEntry.requiredExtensions; }
  get root() { return this.#root; }

  toCatalogEntry() { return this.#catalogEntry; }
}

/** Provider выбирает bundled Project Template независимо от Agent и Extensions. */
export class BundledTemplateProvider {
  #catalog;
  #defaultId;
  #packages;

  constructor(packages = [], { defaultId = "default" } = {}) {
    if (
      !Array.isArray(packages) ||
      packages.some((templatePackage) => !(templatePackage instanceof BundledTemplatePackage))
    ) {
      invalid("packages должен содержать BundledTemplatePackage");
    }
    if (typeof defaultId !== "string" || !CORE_PATTERNS.id.test(defaultId)) {
      invalid("defaultId должен быть lowercase kebab-case");
    }
    const sorted = [...packages].sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(sorted.map(({ id }) => id)).size !== sorted.length) {
      invalid("packages содержит повторяющийся template-id");
    }
    if (sorted.length > 0 && !sorted.some(({ id }) => id === defaultId)) {
      invalid(`defaultId '${defaultId}' не входит в bundled Template catalog`);
    }
    this.#packages = Object.freeze(sorted);
    this.#catalog = new TemplateCatalog(sorted.map((templatePackage) => (
      templatePackage.toCatalogEntry()
    )));
    this.#defaultId = defaultId;
    Object.freeze(this);
  }

  get catalog() { return this.#catalog; }
  get defaultId() { return this.#defaultId; }

  resolve(templateId) {
    const templatePackage = this.#packages.find(({ id }) => id === templateId);
    if (!templatePackage) {
      throw new Error(`TEMPLATE_NOT_DISCOVERED: template-id '${templateId ?? ""}' не найден`);
    }
    return templatePackage;
  }
}

/** Пустой provider по умолчанию; distribution наполняет его в composition root. */
export const bundledTemplates = Object.freeze(new BundledTemplateProvider());
