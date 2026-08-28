/** @fileoverview Core-owned OpenSpec Store pointer одного Code Repository. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { ensureDirectory, lstatOrNull } from "./fs.js";
import { parseOpenSpecJson } from "./openspec.js";
import { ScopedProcess } from "./process.js";

/** Создаёт и проверяет config-only pointer без доступа к Master Specs. */
export class OpenSpecPointerService {
  #executor;
  #writer;

  constructor(writer = atomicWriter, executor = execa) {
    this.#writer = writer;
    this.#executor = executor;
    Object.freeze(this);
  }

  /** Находит config-only pointer среди текущего каталога и родителей. */
  async find(start) {
    let candidate = path.resolve(start);
    const initial = await lstatOrNull(candidate);
    if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
    if (!initial.isDirectory()) candidate = path.dirname(candidate);
    while (true) {
      const target = path.join(candidate, CORE_FILES.openSpecConfig);
      const stat = await lstatOrNull(target);
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error(`${CORE_FILES.openSpecConfig} должна быть обычным файлом`);
        }
        const source = (await fs.readFile(target, "utf8")).replaceAll("\r\n", "\n");
        const match = source.match(/^store: ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\n?$/);
        if (!match || !CORE_PATTERNS.id.test(match[1])) {
          throw new Error(`${CORE_FILES.openSpecConfig} должна содержать только 'store: <id>'`);
        }
        return Object.freeze({ root: await fs.realpath(candidate), storeId: match[1] });
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    throw Object.assign(
      new Error(`Не удалось найти Store или Code Repository с ${CORE_FILES.openSpecConfig}`),
      { code: "STORE_ROOT_NOT_FOUND" },
    );
  }

  /** Разрешает pointer через официальный OpenSpec context без предположений о Workspace path. */
  async resolve(start) {
    const pointer = await this.find(start);
    const args = ["context", "--json"];
    const command = `openspec ${args.join(" ")}`;
    const output = await new ScopedProcess(pointer.root, this.#executor).run("openspec", args);
    const root = parseOpenSpecJson(output, command).root;
    if (
      !root ||
      typeof root !== "object" ||
      typeof root.path !== "string" ||
      !path.isAbsolute(root.path) ||
      root.source !== "declared" ||
      root.store_id !== pointer.storeId
    ) {
      throw new Error(
        `${command}: pointer не разрешён в ожидаемый зарегистрированный Store`,
      );
    }
    return Object.freeze({
      repositoryRoot: pointer.root,
      storeId: pointer.storeId,
      storeRoot: path.resolve(root.path),
    });
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
    const directoryStat = await ensureDirectory(directory);
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
