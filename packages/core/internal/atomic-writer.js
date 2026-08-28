/** @fileoverview Переиспользуемая атомарная запись Core-owned файлов. */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { lstatOrNull } from "./fs.js";

/** Атомарно заменяет обычный файл через временный файл в том же каталоге. */
export class AtomicWriter {
  async write(target, contents, { mode } = {}) {
    if (typeof target !== "string" || !path.isAbsolute(target)) {
      throw new Error("ATOMIC_WRITE_INVALID: target должен быть абсолютным путём");
    }
    if (typeof contents !== "string") {
      throw new Error("ATOMIC_WRITE_INVALID: contents должен быть строкой");
    }
    const existing = await lstatOrNull(target);
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new Error(`ATOMIC_WRITE_UNSAFE: ${target} должен быть обычным файлом`);
    }
    const directory = path.dirname(target);
    const temporary = path.join(
      directory,
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
}

/** Общий atomic writer нового Core. */
export const atomicWriter = Object.freeze(new AtomicWriter());
