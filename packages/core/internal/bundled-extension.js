/** @fileoverview Distribution-owned standalone Agent Extensions. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { ExtensionDescriptor, ExtensionPackage } from "@openspec-orch/extension-sdk";

import { ExtensionCatalog, ExtensionCatalogEntry } from "./extension-catalog.js";
import { isContainedPath } from "./path.js";

const PACKAGE_CONSTRUCTION = Symbol("BundledExtensionPackage construction");

/** Завершает операцию стабильной ошибкой bundled Extension provider. */
function invalid(message, options) {
  throw new Error(`BUNDLED_EXTENSION_INVALID: ${message}`, options);
}

/** Нормализует IDs из фактически загруженного Agent catalog. */
function normalizeAgentIds(agentIds) {
  if (
    !Array.isArray(agentIds) ||
    agentIds.length === 0 ||
    agentIds.some((agentId) => typeof agentId !== "string" || !agentId)
  ) {
    invalid("agentIds должен содержать IDs доступных Agent");
  }
  const normalized = [...agentIds].sort();
  if (new Set(normalized).size !== normalized.length) {
    invalid("agentIds не должен содержать повторяющиеся IDs");
  }
  return normalized;
}

/** Читает и проверяет exact Extension descriptor. */
async function loadDescriptor(root, manifestKeys) {
  const descriptorPath = path.join(root, "extension.yaml");
  const descriptorStat = await fs.lstat(descriptorPath).catch((cause) => {
    invalid("extension.yaml отсутствует", { cause });
  });
  if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) {
    invalid("extension.yaml должен быть обычным файлом, а не symlink");
  }
  let descriptor;
  try {
    descriptor = parse(await fs.readFile(descriptorPath, "utf8"));
  } catch (cause) {
    invalid("extension.yaml содержит некорректный YAML", { cause });
  }
  try {
    return new ExtensionDescriptor(descriptor, { agentIds: manifestKeys });
  } catch (cause) {
    invalid(cause.message, { cause });
  }
}

/** Читает и проверяет обычный файл внутри Extension root. */
async function validateManifest(root, declaration) {
  if (
    typeof declaration !== "string" ||
    !declaration ||
    path.isAbsolute(declaration) ||
    declaration.includes("\\")
  ) {
    invalid(`manifest '${declaration ?? ""}' должен быть относительным POSIX-путём`);
  }
  const segments = declaration.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    invalid(`manifest '${declaration}' выходит за допустимые границы`);
  }
  const target = path.resolve(root, ...segments);
  if (!isContainedPath(root, target)) {
    invalid(`manifest '${declaration}' выходит за Extension root`);
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((cause) => {
      invalid(`manifest '${declaration}' отсутствует`, { cause });
    });
    if (stat.isSymbolicLink()) invalid(`manifest '${declaration}' не должен проходить через symlink`);
  }
  const stat = await fs.stat(target);
  if (!stat.isFile()) invalid(`manifest '${declaration}' должен быть обычным файлом`);
}

/** Immutable Extension package, уже проверенный относительно локальной поставки. */
export class BundledExtensionPackage {
  #catalogEntry;
  #manifests;
  #root;

  constructor({ catalogEntry, manifests, root } = {}, token) {
    if (token !== PACKAGE_CONSTRUCTION) {
      invalid("используйте BundledExtensionPackage.load");
    }
    this.#catalogEntry = catalogEntry;
    this.#manifests = Object.freeze({ ...manifests });
    this.#root = root;
    Object.freeze(this);
  }

  static async load(root, { agentIds } = {}) {
    const manifestKeys = normalizeAgentIds(agentIds);
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      invalid("root должен быть абсолютным путём");
    }
    const rootStat = await fs.lstat(root).catch((cause) => {
      invalid("Extension root отсутствует", { cause });
    });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      invalid("Extension root должен быть обычной директорией, а не symlink");
    }
    const canonicalRoot = await fs.realpath(root);
    const descriptor = await loadDescriptor(canonicalRoot, manifestKeys);
    const source = `bundled:${descriptor.id}`;
    const catalogEntry = new ExtensionCatalogEntry({
      id: descriptor.id,
      name: descriptor.name,
      source,
    });
    await Promise.all(Object.values(descriptor.manifests).map((manifest) => (
      validateManifest(canonicalRoot, manifest)
    )));
    return new BundledExtensionPackage({
      catalogEntry,
      manifests: descriptor.manifests,
      root: canonicalRoot,
    }, PACKAGE_CONSTRUCTION);
  }

  get id() { return this.#catalogEntry.id; }
  get manifests() { return this.#manifests; }
  get name() { return this.#catalogEntry.name; }
  get root() { return this.#root; }
  get source() { return this.#catalogEntry.source; }

  toCatalogEntry() {
    return this.#catalogEntry;
  }
}

/** Загружает standalone Extension из установленного npm package. */
export class NpmExtensionPackage {
  static async load(root, { agentIds, expectedId } = {}) {
    const manifestPath = path.join(root, "package.json");
    const stat = await fs.lstat(manifestPath).catch((cause) => {
      invalid("package.json отсутствует", { cause });
    });
    if (!stat.isFile() || stat.isSymbolicLink()) invalid("package.json должен быть обычным файлом");
    let packageContract;
    try {
      packageContract = new ExtensionPackage(JSON.parse(await fs.readFile(manifestPath, "utf8")));
    } catch (cause) {
      invalid(cause.message, { cause });
    }
    const loaded = await BundledExtensionPackage.load(root, { agentIds });
    if (expectedId !== undefined && loaded.id !== expectedId) {
      invalid(`ожидался extension-id ${expectedId}, package содержит ${loaded.id}`);
    }
    return Object.freeze({
      id: loaded.id,
      manifests: loaded.manifests,
      name: loaded.name,
      root: loaded.root,
      source: `${packageContract.name}@${packageContract.version}`,
    });
  }
}

/** Catalog и resolver встроенных standalone Extensions без собственного lifecycle. */
export class BundledExtensionProvider {
  #catalog;
  #packages;

  constructor(packages = [], { catalogExcludeIds = [] } = {}) {
    if (
      !Array.isArray(packages) ||
      packages.some((extensionPackage) => !(extensionPackage instanceof BundledExtensionPackage))
    ) {
      invalid("packages должен содержать BundledExtensionPackage");
    }
    if (
      !Array.isArray(catalogExcludeIds) ||
      catalogExcludeIds.some((id) => typeof id !== "string") ||
      new Set(catalogExcludeIds).size !== catalogExcludeIds.length
    ) {
      invalid("catalogExcludeIds должен содержать уникальные Extension IDs");
    }
    const sorted = [...packages].sort((left, right) => left.id.localeCompare(right.id));
    const availableIds = new Set(sorted.map(({ id }) => id));
    const unknown = catalogExcludeIds.find((id) => !availableIds.has(id));
    if (unknown) invalid(`catalogExcludeIds содержит неизвестный Extension ID ${unknown}`);
    const excluded = new Set(catalogExcludeIds);
    this.#catalog = new ExtensionCatalog(sorted
      .filter(({ id }) => !excluded.has(id))
      .map((extensionPackage) => (
      extensionPackage.toCatalogEntry()
      )));
    this.#packages = Object.freeze(sorted);
    Object.freeze(this);
  }

  get catalog() { return this.#catalog; }

  has(extensionId) {
    return this.#packages.some(({ id }) => id === extensionId);
  }

  resolve(declaration) {
    const extensionPackage = this.#packages.find(({ id }) => id === declaration?.id);
    if (!extensionPackage) {
      invalid(`${declaration?.id ?? ""} не входит в дистрибутив`);
    }
    return extensionPackage;
  }
}

/** Пустой provider по умолчанию; distribution наполняет его в composition root. */
export const bundledExtensions = Object.freeze(new BundledExtensionProvider());
