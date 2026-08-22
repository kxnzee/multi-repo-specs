/** @fileoverview Core-owned OpenSpec Store pointer одного Code Repository. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_FILES } from "./constants.js";

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Создаёт и проверяет config-only pointer без доступа к Master Specs. */
export class OpenSpecPointerService {
  #writer;

  constructor(writer = atomicWriter) {
    this.#writer = writer;
    Object.freeze(this);
  }

  async connect(checkout, storeId) {
    if (!checkout?.repository?.isCode()) {
      throw new Error("POINTER_INVALID: требуется Code RepositoryCheckout");
    }
    const directory = path.join(checkout.root, CORE_FILES.openSpecDirectory);
    for (const localDirectory of ["specs", "changes"]) {
      if (await lstatOrNull(path.join(directory, localDirectory))) {
        throw new Error(
          `${checkout.root} содержит локальный openspec/${localDirectory}; ` +
            "требуется отдельная миграция",
        );
      }
    }
    const existingDirectory = await lstatOrNull(directory);
    if (!existingDirectory) {
      try {
        await fs.mkdir(directory);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error(`${CORE_FILES.openSpecDirectory} должен быть обычным каталогом`);
    }
    const target = path.join(checkout.root, CORE_FILES.openSpecConfig);
    const expected = `store: ${storeId}\n`;
    const existing = await lstatOrNull(target);
    if (!existing) {
      await this.#writer.write(target, expected);
      return true;
    }
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`${CORE_FILES.openSpecConfig} должна быть обычным файлом`);
    }
    const actual = (await fs.readFile(target, "utf8")).replaceAll("\r\n", "\n");
    if (actual !== expected) {
      throw new Error(
        `${CORE_FILES.openSpecConfig} должна содержать только 'store: ${storeId}'`,
      );
    }
    return false;
  }
}

/** Общий OpenSpec Pointer Service нового Core. */
export const pointers = Object.freeze(new OpenSpecPointerService());
