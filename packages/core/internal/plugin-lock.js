/** @fileoverview Атомарный переносимый lock установленных Plugin packages. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_CONTRACT_VERSIONS, CORE_FILES, CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { locks } from "./lock.js";
import { PluginInstallationRecord } from "./plugin-installation-record.js";
import { deepFreeze } from "./value.js";

/** Завершает проверку стабильной ошибкой Plugin lock. */
function invalid(message, options) {
  throw new Error(`PLUGIN_LOCK_INVALID: ${message}`, options);
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

/** Проверяет Store checkout. */
function assertStoreCheckout(checkout) {
  if (
    !checkout ||
    checkout.role !== "store" ||
    typeof checkout.root !== "string" ||
    typeof checkout.repository?.isStore !== "function" ||
    !checkout.repository.isStore()
  ) {
    invalid("требуется Store RepositoryCheckout");
  }
}

/** Создаёт безопасный lock directory внутри Store. */
async function ensureLockDirectory(root) {
  let current = root;
  for (const segment of CORE_SERVICE_PATHS.lockDirectory.split("/")) {
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
      invalid(`${CORE_SERVICE_PATHS.lockDirectory} содержит небезопасный segment`);
    }
  }
}

/** Immutable aggregate всех project Plugin installation records. */
export class PluginLock {
  #records;

  constructor(records = []) {
    if (!Array.isArray(records) || records.some((record) => !(record instanceof PluginInstallationRecord))) {
      invalid("records должен быть массивом PluginInstallationRecord");
    }
    const sorted = [...records].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    if (new Set(sorted.map((record) => record.pluginId)).size !== sorted.length) {
      invalid("records содержит повторяющийся plugin_id");
    }
    this.#records = Object.freeze(sorted);
    Object.freeze(this);
  }

  /** Восстанавливает строгий lock envelope из JSON. */
  static parse(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== "lock_version\0plugins" ||
      value.lock_version !== CORE_CONTRACT_VERSIONS.pluginLock ||
      !Array.isArray(value.plugins)
    ) {
      invalid(`поддерживается lock_version ${CORE_CONTRACT_VERSIONS.pluginLock}`);
    }
    return new PluginLock(value.plugins.map((record) => PluginInstallationRecord.parse(record)));
  }

  get records() { return this.#records; }

  get(pluginId) {
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid("pluginId должен быть lowercase kebab-case");
    }
    return this.#records.find((record) => record.pluginId === pluginId) ?? null;
  }

  with(record) {
    if (!(record instanceof PluginInstallationRecord)) {
      invalid("требуется PluginInstallationRecord");
    }
    return new PluginLock([
      ...this.#records.filter((current) => current.pluginId !== record.pluginId),
      record,
    ]);
  }

  without(pluginId) {
    this.get(pluginId);
    return new PluginLock(this.#records.filter((record) => record.pluginId !== pluginId));
  }

  toJSON() {
    return deepFreeze({
      lock_version: CORE_CONTRACT_VERSIONS.pluginLock,
      plugins: this.#records.map((record) => record.toJSON()),
    });
  }
}

/** Store-scoped persistence openspec-orch.plugins-lock.json. */
export class PluginLockStore {
  #checkout;
  #lock;
  #writer;

  constructor(storeCheckout, { lock = locks, writer = atomicWriter } = {}) {
    assertStoreCheckout(storeCheckout);
    if (typeof lock?.run !== "function") invalid("lock должен предоставлять run");
    if (typeof writer?.write !== "function") invalid("writer должен предоставлять write");
    this.#checkout = storeCheckout;
    this.#lock = lock;
    this.#writer = writer;
    Object.freeze(this);
  }

  async read() {
    const root = await this.#root();
    const target = path.join(root, CORE_FILES.pluginLock);
    const stat = await lstatOrNull(target);
    if (!stat) return new PluginLock();
    if (!stat.isFile() || stat.isSymbolicLink()) {
      invalid(`${CORE_FILES.pluginLock} должен быть обычным файлом`);
    }
    try {
      return PluginLock.parse(JSON.parse(await fs.readFile(target, "utf8")));
    } catch (error) {
      if (error.message.startsWith("PLUGIN_LOCK_INVALID:")) throw error;
      invalid(`${CORE_FILES.pluginLock}: ${error.message}`, { cause: error });
    }
  }

  async write(pluginLock) {
    if (!(pluginLock instanceof PluginLock)) invalid("требуется PluginLock");
    return this.update(() => pluginLock);
  }

  async update(operation) {
    if (typeof operation !== "function") invalid("operation должна быть функцией");
    const root = await this.#root();
    await ensureLockDirectory(root);
    return this.#lock.run(
      path.join(root, CORE_SERVICE_PATHS.pluginLockLock),
      async () => {
        const current = await this.read();
        const next = await operation(current);
        if (!(next instanceof PluginLock)) invalid("operation должна вернуть PluginLock");
        await this.#writer.write(
          path.join(root, CORE_FILES.pluginLock),
          `${JSON.stringify(next.toJSON(), null, 2)}\n`,
          { mode: 0o644 },
        );
        return next;
      },
      { busyCode: "PLUGIN_LOCK_BUSY" },
    );
  }

  async #root() {
    const stat = await lstatOrNull(this.#checkout.root);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      invalid("Store root должен быть обычным каталогом");
    }
    return fs.realpath(this.#checkout.root);
  }
}

/** Factory Store-scoped Plugin lock persistence. */
export class PluginLockService {
  forStore(storeCheckout) {
    return new PluginLockStore(storeCheckout);
  }
}

/** Общий Plugin lock service нового Core. */
export const pluginLocks = Object.freeze(new PluginLockService());
