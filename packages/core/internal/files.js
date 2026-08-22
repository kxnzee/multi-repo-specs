/** @fileoverview Безопасные files, привязанные к RepositoryCheckout. */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

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

  constructor(checkout) {
    this.#root = checkout.root;
    Object.freeze(this);
  }

  get root() {
    return this.#root;
  }

  async read(relativePath) {
    const target = await this.#resolveExisting(relativePath, "file");
    return fs.readFile(target, "utf8");
  }

  async write(relativePath, contents, { mode } = {}) {
    if (typeof contents !== "string") throw new Error("Содержимое файла должно быть строкой");
    const target = await this.#resolveDeclared(relativePath);
    const parent = await this.#resolveExisting(
      path.posix.dirname(relativePath),
      "directory",
      { allowDot: true },
    );
    if (parent !== path.dirname(target)) {
      throw new Error(`Путь ${relativePath} выходит за Repository root`);
    }
    const temporary = path.join(
      parent,
      `.${path.basename(target)}-${process.pid}-${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(
        temporary,
        contents,
        mode === undefined
          ? { encoding: "utf8", flag: "wx" }
          : { encoding: "utf8", flag: "wx", mode },
      );
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async #resolveExisting(relativePath, kind, { allowDot = false } = {}) {
    const target = await this.#resolveDeclared(relativePath, { allowDot });
    const stat = await lstatOrNull(target);
    if (!stat) throw new Error(`Отсутствует ${kind === "file" ? "обычный файл" : "каталог"} ${relativePath}`);
    if (stat.isSymbolicLink()) throw new Error(`Путь ${relativePath} содержит symlink`);
    if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
      throw new Error(
        `${relativePath} должен быть обычным ${kind === "file" ? "файлом" : "каталогом"}`,
      );
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
