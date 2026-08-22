/** @fileoverview Локальные machine-specific sources для development Plugins. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_CONTRACT_VERSIONS, CORE_FILES, CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { locks } from "./lock.js";
import { PluginSource } from "./plugin-source.js";

/** Завершает операцию стабильной ошибкой local Plugin overrides. */
function invalid(message, options) {
  throw new Error(`LOCAL_PLUGIN_OVERRIDE_INVALID: ${message}`, options);
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

/** Создаёт безопасную Core-owned directory chain. */
async function ensureDirectories(root, relativePath) {
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
      invalid(`${relativePath} содержит небезопасный segment`);
    }
  }
}

/** Проверяет Store checkout для Store-local persistence. */
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

/** Проверяет Plugin ID до чтения или изменения mapping. */
function assertPluginId(pluginId) {
  if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
    invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
  }
}

/** Проверяет Plugin ID и абсолютный machine-local source path. */
function assertEntry(pluginId, sourcePath) {
  assertPluginId(pluginId);
  if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
    invalid(`source path для ${pluginId} должен быть абсолютным`);
  }
}

/** Immutable mapping Plugin ID -> local source path. */
export class LocalPluginOverrides {
  #entries;

  constructor(entries = []) {
    if (!Array.isArray(entries)) invalid("entries должен быть массивом");
    const normalized = entries.map(([pluginId, sourcePath]) => {
      assertEntry(pluginId, sourcePath);
      return Object.freeze([pluginId, path.normalize(sourcePath)]);
    }).sort(([left], [right]) => left.localeCompare(right));
    if (new Set(normalized.map(([pluginId]) => pluginId)).size !== normalized.length) {
      invalid("plugins содержит повторяющийся plugin-id");
    }
    this.#entries = Object.freeze(normalized);
    Object.freeze(this);
  }

  static parse(value) {
    const keys = value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort()
      : [];
    if (
      keys.join("\0") !== ["plugins", "version"].join("\0") ||
      value.version !== CORE_CONTRACT_VERSIONS.localPluginOverrides ||
      !value.plugins ||
      typeof value.plugins !== "object" ||
      Array.isArray(value.plugins)
    ) {
      invalid(`некорректный ${CORE_FILES.localPluginOverrides}`);
    }
    return new LocalPluginOverrides(Object.entries(value.plugins));
  }

  get entries() { return this.#entries; }
  get(pluginId) {
    assertPluginId(pluginId);
    return this.#entries.find(([id]) => id === pluginId)?.[1];
  }
  has(pluginId) { return this.get(pluginId) !== undefined; }

  with(pluginId, sourcePath) {
    assertEntry(pluginId, sourcePath);
    return new LocalPluginOverrides([
      ...this.#entries.filter(([id]) => id !== pluginId),
      [pluginId, sourcePath],
    ]);
  }

  without(pluginId) {
    assertPluginId(pluginId);
    return new LocalPluginOverrides(this.#entries.filter(([id]) => id !== pluginId));
  }

  toJSON() {
    return Object.freeze({
      version: CORE_CONTRACT_VERSIONS.localPluginOverrides,
      plugins: Object.freeze(Object.fromEntries(this.#entries)),
    });
  }
}

/** Store-scoped persistence machine-local Plugin sources. */
export class LocalPluginOverrideStore {
  #checkout;
  #lock;
  #writer;

  constructor(storeCheckout, { lock = locks, writer = atomicWriter } = {}) {
    assertStoreCheckout(storeCheckout);
    if (typeof lock?.run !== "function" || typeof writer?.write !== "function") {
      invalid("требуются lock и atomic writer");
    }
    this.#checkout = storeCheckout;
    this.#lock = lock;
    this.#writer = writer;
    Object.freeze(this);
  }

  async read() {
    const rootStat = await lstatOrNull(this.#checkout.root);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      invalid("Store root должен быть существующим обычным каталогом");
    }
    let directory = this.#checkout.root;
    const relativeDirectory = path.posix.dirname(CORE_FILES.localPluginOverrides);
    for (const segment of relativeDirectory.split("/")) {
      directory = path.join(directory, segment);
      const directoryStat = await lstatOrNull(directory);
      if (!directoryStat) return new LocalPluginOverrides();
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        invalid(`${relativeDirectory} содержит небезопасный segment`);
      }
    }
    const target = path.join(this.#checkout.root, CORE_FILES.localPluginOverrides);
    const stat = await lstatOrNull(target);
    if (!stat) return new LocalPluginOverrides();
    if (!stat.isFile() || stat.isSymbolicLink()) {
      invalid(`${CORE_FILES.localPluginOverrides} должен быть обычным файлом`);
    }
    try {
      return LocalPluginOverrides.parse(JSON.parse(await fs.readFile(target, "utf8")));
    } catch (error) {
      if (error.message.startsWith("LOCAL_PLUGIN_OVERRIDE_INVALID:")) throw error;
      invalid(`${CORE_FILES.localPluginOverrides}: ${error.message}`, { cause: error });
    }
  }

  async set(pluginId, source) {
    if (
      !(source instanceof PluginSource) ||
      !source.developmentOnly ||
      source.declaration !== "local" ||
      typeof source.installSpec !== "string" ||
      !path.isAbsolute(source.installSpec)
    ) {
      invalid("требуется machine-local PluginSource");
    }
    const stat = await lstatOrNull(source.installSpec);
    if (!stat || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      invalid("local source должен быть существующим обычным файлом или каталогом");
    }
    const canonical = await fs.realpath(source.installSpec);
    return this.#update((current) => current.with(pluginId, canonical));
  }

  async resolve(pluginId) {
    const sourcePath = (await this.read()).get(pluginId);
    if (!sourcePath) return null;
    const stat = await lstatOrNull(sourcePath);
    if (!stat || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return null;
    const source = PluginSource.parse(sourcePath, { cwd: this.#checkout.root });
    return source.developmentOnly && source.declaration === "local" ? source : null;
  }

  async remove(pluginId) {
    return this.#update((current) => current.without(pluginId));
  }

  async #update(operation) {
    await ensureDirectories(this.#checkout.root, CORE_SERVICE_PATHS.lockDirectory);
    return this.#lock.run(
      path.join(this.#checkout.root, CORE_SERVICE_PATHS.localPluginOverridesLock),
      async () => {
        const next = operation(await this.read());
        await this.#writer.write(
          path.join(this.#checkout.root, CORE_FILES.localPluginOverrides),
          `${JSON.stringify(next.toJSON(), null, 2)}\n`,
          { mode: 0o600 },
        );
        return next;
      },
      { busyCode: "LOCAL_PLUGIN_OVERRIDE_BUSY" },
    );
  }
}

/** Создаёт Store-local override boundary без раскрытия пути через Plugin SDK. */
export class LocalPluginOverrideService {
  forStore(storeCheckout) {
    return new LocalPluginOverrideStore(storeCheckout);
  }
}

/** Общий local Plugin override service нового Core. */
export const localPluginOverrides = Object.freeze(new LocalPluginOverrideService());
