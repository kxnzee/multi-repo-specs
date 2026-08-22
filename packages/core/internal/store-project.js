/** @fileoverview Общий Core facade загрузки Store и его Project registry. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { RepositoryCheckout } from "./checkout.js";
import { configuration } from "./configuration.js";
import { CORE_FILES } from "./constants.js";

const REQUIRED_ROOT_FILES = Object.freeze([
  CORE_FILES.storeMetadata,
  CORE_FILES.orchestratorConfig,
  CORE_FILES.openSpecConfig,
]);

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Безопасно читает обычный project file без symlink в parent chain. */
async function readProjectFile(root, relativePath) {
  const segments = relativePath.split("/");
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) throw new Error(`Отсутствует обычный файл ${relativePath}`);
    if (stat.isSymbolicLink()) throw new Error(`Путь ${relativePath} содержит symlink`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) throw new Error(`Путь ${relativePath} проходит через файл`);
    if (final && !stat.isFile()) throw new Error(`${relativePath} должна быть обычным файлом`);
  }
  return fs.readFile(current, "utf8");
}

/** Immutable загруженный Store и связанный с ним Project registry. */
export class StoreProject {
  #root;
  #store;
  #project;
  #checkout;

  constructor({ root, store, project }) {
    if (typeof root !== "string" || !path.isAbsolute(root)) {
      throw new Error(`STORE_PROJECT_INVALID: root должен быть абсолютным путём: ${root}`);
    }
    if (project.storeRepository.id !== store.id) {
      throw new Error(
        `Store ID в ${CORE_FILES.orchestratorConfig} не совпадает с Store metadata`,
      );
    }
    if (!store.remote || !project.storeRepository.matchesRemote(store.remote)) {
      throw new Error("URL role: store не совпадает с Store metadata");
    }
    this.#root = path.normalize(root);
    this.#store = store;
    this.#project = project;
    this.#checkout = new RepositoryCheckout(project.storeRepository, this.#root);
    Object.freeze(this);
  }

  get root() {
    return this.#root;
  }

  get store() {
    return this.#store;
  }

  get project() {
    return this.#project;
  }

  get checkout() {
    return this.#checkout;
  }
}

/** Загружает Project из известного Store либо находит Store среди parent directories. */
export class StoreProjectService {
  #configuration;

  constructor(configurationService = configuration) {
    this.#configuration = configurationService;
    Object.freeze(this);
  }

  async load(root) {
    const candidate = path.resolve(root);
    const stat = await lstatOrNull(candidate);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Store должен быть существующим обычным каталогом: ${candidate}`);
    }
    const canonicalRoot = await fs.realpath(candidate);
    const [store, project] = await Promise.all([
      readProjectFile(canonicalRoot, CORE_FILES.storeMetadata)
        .then((source) => this.#configuration.parseStore(source)),
      readProjectFile(canonicalRoot, CORE_FILES.orchestratorConfig)
        .then((source) => this.#configuration.parseProject(source)),
    ]);
    return new StoreProject({ root: canonicalRoot, store, project });
  }

  async find(start = process.cwd()) {
    let candidate = path.resolve(start);
    const initial = await lstatOrNull(candidate);
    if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
    if (!initial.isDirectory()) candidate = path.dirname(candidate);
    while (true) {
      if (await this.#hasRequiredRoot(candidate)) return this.load(candidate);
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    throw Object.assign(
      new Error("Не удалось найти Spec Root среди родителей текущего каталога"),
      { code: "STORE_ROOT_NOT_FOUND" },
    );
  }

  async #hasRequiredRoot(candidate) {
    const stats = await Promise.all(
      REQUIRED_ROOT_FILES.map((relativePath) => lstatOrNull(path.join(candidate, relativePath))),
    );
    for (const [index, stat] of stats.entries()) {
      if (stat?.isSymbolicLink()) {
        throw new Error(`${REQUIRED_ROOT_FILES[index]} должна быть обычным файлом`);
      }
    }
    return stats.every((stat) => stat?.isFile());
  }
}

/** Общий Store Project facade нового Core. */
export const storeProjects = Object.freeze(new StoreProjectService());
