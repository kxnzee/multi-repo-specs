/** @fileoverview Локальное Core state только для multi-repo workspace metadata. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_CONTRACT_VERSIONS, CORE_SERVICE_PATHS } from "./constants.js";
import { ensureDirectory, lstatOrNull } from "./fs.js";
import { locks } from "./lock.js";

/** Проверяет либо создаёт Core-owned directory chain. */
async function ensureDirectories(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await ensureDirectory(current, { mode: 0o700 });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`STATE_CORRUPTED: ${current} должен быть обычным каталогом`);
    }
  }
}

/** Immutable Core-owned state без Plugin business data. */
export class CoreState {
  #workspace;

  constructor({ contract_version: contractVersion = CORE_CONTRACT_VERSIONS.coreState, workspace = null } = {}) {
    if (contractVersion !== CORE_CONTRACT_VERSIONS.coreState) {
      throw new Error(
        `STATE_CORRUPTED: поддерживается contract_version ${CORE_CONTRACT_VERSIONS.coreState}`,
      );
    }
    if (workspace !== null && (typeof workspace !== "string" || !path.isAbsolute(workspace))) {
      throw new Error("STATE_CORRUPTED: workspace должен быть абсолютным путём или null");
    }
    this.#workspace = workspace === null ? null : path.normalize(workspace);
    Object.freeze(this);
  }

  get workspace() {
    return this.#workspace;
  }

  rememberWorkspace(workspace) {
    return new CoreState({ workspace });
  }

  toJSON() {
    return Object.freeze({
      contract_version: CORE_CONTRACT_VERSIONS.coreState,
      workspace: this.#workspace,
    });
  }
}

/** Атомарное fail-closed persistence Core state одного Store checkout. */
export class CoreStateStore {
  #root;
  #writer;
  #lock;

  constructor(storeCheckout, { writer = atomicWriter, lock = locks } = {}) {
    if (
      !storeCheckout ||
      typeof storeCheckout.root !== "string" ||
      typeof storeCheckout.repository?.isStore !== "function" ||
      !storeCheckout.repository.isStore()
    ) {
      throw new Error("STATE_INVALID: требуется Store RepositoryCheckout");
    }
    this.#root = storeCheckout.root;
    this.#writer = writer;
    this.#lock = lock;
    Object.freeze(this);
  }

  async read() {
    await this.#assertRoot();
    const directory = await lstatOrNull(path.join(this.#root, CORE_SERVICE_PATHS.directory));
    if (!directory) return new CoreState();
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error(
        `STATE_CORRUPTED: ${CORE_SERVICE_PATHS.directory} должен быть обычным каталогом`,
      );
    }
    const target = path.join(this.#root, CORE_SERVICE_PATHS.coreState);
    const stat = await lstatOrNull(target);
    if (!stat) return new CoreState();
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`STATE_CORRUPTED: ${CORE_SERVICE_PATHS.coreState} должен быть обычным файлом`);
    }
    let value;
    try {
      value = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
      throw new Error(`STATE_CORRUPTED: ${CORE_SERVICE_PATHS.coreState}: ${error.message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`STATE_CORRUPTED: ${CORE_SERVICE_PATHS.coreState} должен содержать object`);
    }
    if (Object.keys(value).sort().join("\0") !== "contract_version\0workspace") {
      throw new Error(
        `STATE_CORRUPTED: ${CORE_SERVICE_PATHS.coreState} содержит не-Core поля; ` +
          "сначала требуется миграция Plugin state",
      );
    }
    return new CoreState(value);
  }

  async write(state) {
    const checked = state instanceof CoreState ? state : new CoreState(state);
    await this.update(() => checked);
    return checked;
  }

  async update(operation) {
    if (typeof operation !== "function") {
      throw new Error("STATE_INVALID: update operation должна быть функцией");
    }
    await this.#assertRoot();
    await ensureDirectories(this.#root, CORE_SERVICE_PATHS.lockDirectory);
    return this.#lock.run(
      path.join(this.#root, CORE_SERVICE_PATHS.coreStateLock),
      async () => {
        const current = await this.read();
        const value = await operation(current);
        const next = value instanceof CoreState ? value : new CoreState(value);
        await ensureDirectories(this.#root, CORE_SERVICE_PATHS.directory);
        await this.#writer.write(
          path.join(this.#root, CORE_SERVICE_PATHS.coreState),
          `${JSON.stringify(next.toJSON(), null, 2)}\n`,
          { mode: 0o600 },
        );
        return next;
      },
      { busyCode: "STATE_BUSY" },
    );
  }

  async #assertRoot() {
    const stat = await lstatOrNull(this.#root);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("STATE_CORRUPTED: Store root должен быть обычным каталогом");
    }
  }
}

/** Factory CoreStateStore поверх проверенного Store checkout. */
export class CoreStateService {
  forStore(storeCheckout) {
    return new CoreStateStore(storeCheckout);
  }
}

/** Общий Core State Service нового Core. */
export const coreState = Object.freeze(new CoreStateService());
