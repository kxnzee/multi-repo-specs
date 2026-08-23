/** @fileoverview Read-only восстановление установленного Plugin из runtime receipt. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { localPluginOverrides } from "./local-plugin-overrides.js";
import { PluginDeclaration } from "./plugin-declaration.js";
import { PluginInstallationRecord } from "./plugin-installation-record.js";
import { pluginLoader } from "./plugin-loader.js";

/** Завершает восстановление стабильной ошибкой Plugin runtime. */
function invalid(message, options) {
  throw new Error(`PLUGIN_RUNTIME_INVALID: ${message}`, options);
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

/** Проверяет Store checkout до чтения runtime. */
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

/** Проверяет ordinary directory chain и возвращает конечный path. */
async function requireDirectory(root, relativePath, { optional = false } = {}) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat && optional) return null;
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      invalid(`${relativePath} должен быть безопасным каталогом`);
    }
  }
  return current;
}

/** Читает и проверяет receipt одной version directory. */
async function readRecord(runtimeRoot, pluginId, version) {
  const target = path.join(runtimeRoot, CORE_SERVICE_PATHS.pluginRuntimeRecord);
  const stat = await lstatOrNull(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    invalid(`${pluginId}@${version} не содержит обычный installation receipt`);
  }
  let value;
  try {
    value = JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    invalid(`${pluginId}@${version} содержит повреждённый receipt`, { cause: error });
  }
  const record = PluginInstallationRecord.parse(value);
  if (record.pluginId !== pluginId || record.version !== version) {
    invalid(`${pluginId}@${version} receipt не совпадает с runtime path`);
  }
  return record;
}

/** Возвращает package root из проверенной top-level dependency receipt. */
async function resolvePackageRoot(runtimeRoot, record) {
  const segments = record.packageName.startsWith("@")
    ? record.packageName.split("/")
    : [record.packageName];
  const relativePath = path.posix.join("node_modules", ...segments);
  const dependency = record.dependencies.find(({ path: dependencyPath }) => (
    dependencyPath === relativePath
  ));
  if (!dependency || dependency.version !== record.version) {
    invalid(`${record.pluginId}@${record.version} receipt не содержит top-level Plugin package`);
  }
  return requireDirectory(runtimeRoot, relativePath);
}

/** Immutable восстановленный runtime и его проверенный Plugin export. */
export class ResolvedPluginRuntime {
  #loadedPlugin;
  #record;
  #root;

  constructor({ loadedPlugin, record, root }) {
    if (
      !loadedPlugin ||
      !(record instanceof PluginInstallationRecord) ||
      loadedPlugin.id !== record.pluginId ||
      loadedPlugin.package.name !== record.packageName ||
      loadedPlugin.package.version !== record.version ||
      typeof root !== "string" ||
      !path.isAbsolute(root)
    ) {
      invalid("runtime, receipt и LoadedPlugin не согласованы");
    }
    this.#loadedPlugin = loadedPlugin;
    this.#record = record;
    this.#root = root;
    Object.freeze(this);
  }

  get loadedPlugin() { return this.#loadedPlugin; }
  get record() { return this.#record; }
  get root() { return this.#root; }
}

/** Resolver, привязанный к одному Store checkout. */
export class StorePluginRuntimeResolver {
  #checkout;
  #loader;
  #localOverrides;

  constructor(
    storeCheckout,
    { loader = pluginLoader, localOverrideService = localPluginOverrides } = {},
  ) {
    assertStoreCheckout(storeCheckout);
    if (typeof loader?.load !== "function" || typeof localOverrideService?.forStore !== "function") {
      invalid("требуются Plugin Loader и local override service");
    }
    this.#checkout = storeCheckout;
    this.#loader = loader;
    this.#localOverrides = localOverrideService;
    Object.freeze(this);
  }

  async resolve(declaration) {
    if (!(declaration instanceof PluginDeclaration)) invalid("требуется PluginDeclaration");
    const rootStat = await lstatOrNull(this.#checkout.root);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      invalid("Store root должен быть существующим обычным каталогом");
    }
    if (
      declaration.source === "local" &&
      !await this.#localOverrides.forStore(this.#checkout).resolve(declaration.id)
    ) {
      invalid(`${declaration.id}: local source недоступен на этой машине`);
    }
    const relativeDirectory = path.posix.join(
      CORE_SERVICE_PATHS.pluginRuntimeDirectory,
      declaration.id,
    );
    const pluginDirectory = await requireDirectory(
      this.#checkout.root,
      relativeDirectory,
      { optional: true },
    );
    if (!pluginDirectory) invalid(`${declaration.id}: runtime не установлен`);
    const entries = await fs.readdir(pluginDirectory, { withFileTypes: true });
    const versions = entries.flatMap((entry) => {
      if (entry.name.startsWith(".install-")) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          invalid(`${declaration.id}: временный runtime содержит небезопасную запись`);
        }
        return [];
      }
      if (!entry.isDirectory() || entry.isSymbolicLink() || !CORE_PATTERNS.exactSemanticVersion.test(entry.name)) {
        invalid(`${declaration.id}: runtime directory содержит неизвестную запись ${entry.name}`);
      }
      return [entry.name];
    }).sort();
    const candidates = [];
    for (const version of versions) {
      const runtimeRoot = await requireDirectory(pluginDirectory, version);
      const record = await readRecord(runtimeRoot, declaration.id, version);
      if (record.source.spec === declaration.source) candidates.push({ record, runtimeRoot });
    }
    if (candidates.length === 0) {
      invalid(`${declaration.id}: runtime для source ${declaration.source} не установлен`);
    }
    if (candidates.length > 1) {
      invalid(`${declaration.id}: найдено несколько runtime для source ${declaration.source}`);
    }
    const [{ record, runtimeRoot }] = candidates;
    const loadedPlugin = await this.#loader.load({
      packageRoot: await resolvePackageRoot(runtimeRoot, record),
      pluginId: declaration.id,
    });
    return new ResolvedPluginRuntime({ loadedPlugin, record, root: runtimeRoot });
  }
}

/** Factory read-only runtime resolvers для Store. */
export class PluginRuntimeService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  forStore(storeCheckout) {
    return new StorePluginRuntimeResolver(storeCheckout, this.#dependencies);
  }
}

/** Общий Plugin Runtime Service нового Core. */
export const pluginRuntimes = Object.freeze(new PluginRuntimeService());
