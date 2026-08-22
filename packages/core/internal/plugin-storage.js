/** @fileoverview Атомарное namespaced storage конкретного Plugin. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_CONTRACT_VERSIONS, CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { locks } from "./lock.js";
import { deepFreeze } from "./value.js";

/** Возвращает независимое immutable JSON-значение или отклоняет не-JSON data. */
function ownJson(value) {
  let source;
  try {
    source = JSON.stringify(value);
  } catch (error) {
    throw new Error(`PLUGIN_STORAGE_INVALID: data должна быть JSON-совместимой: ${error.message}`);
  }
  if (source === undefined) {
    throw new Error("PLUGIN_STORAGE_INVALID: data должна быть JSON-совместимой");
  }
  return deepFreeze(JSON.parse(source));
}

/** Возвращает lstat или null для отсутствующего path. */
async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Создаёт Core-owned directory path и запрещает файл или symlink в каждом сегменте. */
async function ensureDirectories(root, relativePath) {
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${root} должен быть обычным каталогом`);
  }
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const existing = await lstatOrNull(current);
    if (!existing) {
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${current} должен быть обычным каталогом`);
    }
  }
  return current;
}

/** Проверяет существующую directory chain без создания отсутствующего storage. */
async function hasSafeDirectories(root, relativePath) {
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${root} должен быть обычным каталогом`);
  }
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${current} должен быть обычным каталогом`);
    }
  }
  return true;
}

/** Проверяет Store checkout перед созданием scoped storage. */
function assertStoreCheckout(checkout) {
  if (!checkout || checkout.role !== "store" || typeof checkout.root !== "string") {
    throw new Error("PLUGIN_STORAGE_INVALID: требуется Store RepositoryCheckout");
  }
}

/** Проверяет Plugin ID до построения storage path. */
function assertPluginId(pluginId) {
  if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
    throw new Error(`PLUGIN_STORAGE_INVALID: некорректный plugin-id '${pluginId ?? ""}'`);
  }
}

/** Изолированное storage, привязанное к одному Store и одному Plugin ID. */
export class PluginStorage {
  #root;
  #pluginId;
  #writer;
  #lock;

  constructor(storeCheckout, pluginId, { writer = atomicWriter, lock = locks } = {}) {
    assertStoreCheckout(storeCheckout);
    assertPluginId(pluginId);
    this.#root = storeCheckout.root;
    this.#pluginId = pluginId;
    this.#writer = writer;
    this.#lock = lock;
    Object.freeze(this);
  }

  get pluginId() {
    return this.#pluginId;
  }

  async read() {
    return this.#readUnlocked();
  }

  async write(data) {
    const checked = ownJson(data);
    await this.#withLock(() => this.#writeUnlocked(checked));
    return checked;
  }

  async update(operation) {
    if (typeof operation !== "function") {
      throw new Error("PLUGIN_STORAGE_INVALID: update operation должна быть функцией");
    }
    return this.#withLock(async () => {
      const current = await this.#readUnlocked();
      const next = ownJson(await operation(current));
      await this.#writeUnlocked(next);
      return next;
    });
  }

  async #readUnlocked() {
    const target = this.#statePath();
    if (!await hasSafeDirectories(
      this.#root,
      this.#relativePluginDirectory(),
    )) return null;
    const stat = await lstatOrNull(target);
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${this.#relativeStatePath()} должен быть обычным файлом`);
    }
    let value;
    try {
      value = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
      throw new Error(`PLUGIN_STORAGE_CORRUPTED: ${this.#relativeStatePath()}: ${error.message}`);
    }
    const keys = value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort()
      : [];
    if (
      keys.join("\0") !== ["data", "plugin_id", "storage_version"].join("\0") ||
      value.storage_version !== CORE_CONTRACT_VERSIONS.pluginStorage ||
      value.plugin_id !== this.#pluginId
    ) {
      throw new Error(`PLUGIN_STORAGE_CORRUPTED: некорректный envelope ${this.#relativeStatePath()}`);
    }
    return ownJson(value.data);
  }

  async #writeUnlocked(data) {
    await ensureDirectories(this.#root, this.#relativePluginDirectory());
    const envelope = {
      storage_version: CORE_CONTRACT_VERSIONS.pluginStorage,
      plugin_id: this.#pluginId,
      data,
    };
    await this.#writer.write(
      this.#statePath(),
      `${JSON.stringify(envelope, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  async #withLock(operation) {
    await ensureDirectories(this.#root, CORE_SERVICE_PATHS.lockDirectory);
    return this.#lock.run(
      path.join(this.#root, this.#relativeLockPath()),
      operation,
      { busyCode: "PLUGIN_STORAGE_BUSY" },
    );
  }

  #relativePluginDirectory() {
    return path.posix.join(CORE_SERVICE_PATHS.pluginsDirectory, this.#pluginId);
  }

  #relativeLockPath() {
    return path.posix.join(CORE_SERVICE_PATHS.lockDirectory, `${this.#pluginId}.lock`);
  }

  #relativeStatePath() {
    return path.posix.join(this.#relativePluginDirectory(), CORE_SERVICE_PATHS.pluginStateFile);
  }

  #statePath() {
    return path.join(this.#root, this.#relativeStatePath());
  }
}

/** Создаёт Plugin-scoped storage без раскрытия физического path. */
export class PluginStorageService {
  forPlugin(storeCheckout, pluginId) {
    return new PluginStorage(storeCheckout, pluginId);
  }
}

/** Общий Plugin Storage Service нового Core. */
export const pluginStorage = Object.freeze(new PluginStorageService());
