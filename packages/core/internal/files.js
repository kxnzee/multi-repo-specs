/** @fileoverview Безопасные files, привязанные к RepositoryCheckout. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { isPortableRelativePath } from "./path.js";

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Files API внутри одного canonical Repository root. */
export class RepositoryFiles {
  #root;
  #writer;

  constructor(checkout, writer = atomicWriter) {
    this.#root = checkout.root;
    this.#writer = writer;
    Object.freeze(this);
  }

  get root() {
    return this.#root;
  }

  async read(relativePath, { optional = false } = {}) {
    if (typeof optional !== "boolean") {
      throw new Error("Параметр optional должен быть boolean");
    }
    const target = await this.#resolveExisting(relativePath, "file", { optional });
    if (target === null) return null;
    return fs.readFile(target, "utf8");
  }

  async write(relativePath, contents, { mode } = {}) {
    if (typeof contents !== "string") throw new Error("Содержимое файла должно быть строкой");
    const target = await this.#resolveDeclared(relativePath);
    const parent = await this.#ensureDirectory(path.posix.dirname(relativePath));
    if (parent !== path.dirname(target)) {
      throw new Error(`Путь ${relativePath} выходит за Repository root`);
    }
    await this.#writer.write(target, contents, { mode });
  }

  async #resolveExisting(relativePath, kind, { allowDot = false, optional = false } = {}) {
    const target = await this.#resolveDeclared(relativePath, { allowDot });
    const stat = await lstatOrNull(target);
    if (!stat && optional) return null;
    if (!stat) {
      throw new Error(
        `Отсутствует ${kind === "file" ? "обычный файл" : "каталог"} ${relativePath}`,
      );
    }
    if (stat.isSymbolicLink()) throw new Error(`Путь ${relativePath} содержит symlink`);
    if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
      throw new Error(
        `${relativePath} должен быть обычным ${kind === "file" ? "файлом" : "каталогом"}`,
      );
    }
    return target;
  }

  async #ensureDirectory(relativePath) {
    const target = await this.#resolveDeclared(relativePath, { allowDot: true });
    if (relativePath === ".") return target;
    let current = this.#root;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      const existing = await lstatOrNull(current);
      if (!existing) {
        try {
          await fs.mkdir(current);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Путь ${relativePath} содержит небезопасный каталог`);
      }
    }
    return target;
  }

  async #resolveDeclared(relativePath, { allowDot = false } = {}) {
    if (!isPortableRelativePath(relativePath, { allowDot })) {
      throw new Error(`Некорректный относительный путь файла: ${relativePath ?? ""}`);
    }
    const target = relativePath === "." ? this.#root : path.join(this.#root, relativePath);
    let current = this.#root;
    if (relativePath === ".") return target;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      const stat = await lstatOrNull(current);
      if (!stat) break;
      if (stat.isSymbolicLink()) throw new Error(`Путь ${relativePath} содержит symlink`);
    }
    return target;
  }
}

/** Factory Repository-scoped files. */
export class FileService {
  forRepository(checkout) {
    return new RepositoryFiles(checkout);
  }
}

/** Общий FileService нового Core. */
export const files = Object.freeze(new FileService());
