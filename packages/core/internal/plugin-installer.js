/** @fileoverview Store-scoped построение и атомарная активация Plugin runtime. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CORE_PACKAGES, CORE_PACKAGE_VERSIONS, CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { locks } from "./lock.js";
import { PluginInstallationRecord } from "./plugin-installation-record.js";
import { pluginLoader } from "./plugin-loader.js";
import { npmPackageInstaller } from "./npm-package-installer.js";
import { isContainedPath } from "./path.js";
import { PluginSource } from "./plugin-source.js";

const INSTALLATION_CONSTRUCTION = Symbol("PluginInstallation construction");

/** Завершает операцию стабильной ошибкой Plugin Installer. */
function invalid(message, options) {
  throw new Error(`PLUGIN_INSTALL_INVALID: ${message}`, options);
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

/** Создаёт Core-owned directory chain и запрещает symlink в каждом сегменте. */
async function ensureDirectories(root, relativePath) {
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    invalid("Store root должен быть существующим обычным каталогом");
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
      invalid(`${relativePath} содержит небезопасный directory segment`);
    }
  }
  return current;
}

/** Проверяет Store checkout перед построением Store-scoped Installer. */
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

/** Возвращает безопасный package root внутри runtime node_modules. */
function packageRoot(runtimeRoot, packageName) {
  let packageSource;
  try {
    packageSource = PluginSource.parse(`${packageName}@0.0.0`, { cwd: runtimeRoot });
  } catch (error) {
    invalid(`npm создал некорректное package name '${packageName}'`, { cause: error });
  }
  if (packageSource.kind !== "npm" || packageSource.packageName !== packageName) {
    invalid(`npm создал некорректное package name '${packageName}'`);
  }
  const segments = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some((segment) => !segment || segment === "@" || segment.includes("\\"))
  ) {
    invalid(`npm создал некорректное package name '${packageName}'`);
  }
  const candidate = path.join(runtimeRoot, "node_modules", ...segments);
  if (!isContainedPath(runtimeRoot, candidate)) {
    invalid("package root вышел за границы временного runtime");
  }
  return candidate;
}

/** Читает изменённый npm runtime manifest и определяет установленный Plugin package. */
async function discoverPackageName(runtimeRoot, source) {
  const manifestPath = path.join(runtimeRoot, "package.json");
  const stat = await lstatOrNull(manifestPath);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    invalid("npm runtime package.json должен быть обычным файлом");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    invalid(`npm runtime package.json повреждён: ${error.message}`, { cause: error });
  }
  const dependencies = manifest.dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    invalid("npm не записал Plugin dependency в runtime package.json");
  }
  if (source.packageName) {
    if (typeof dependencies[source.packageName] !== "string") {
      invalid(`npm не установил ожидаемый package ${source.packageName}`);
    }
    return source.packageName;
  }
  const candidates = Object.keys(dependencies).filter((name) => name !== CORE_PACKAGES.pluginSdk);
  if (candidates.length !== 1) {
    invalid("npm runtime должен содержать ровно один устанавливаемый Plugin package");
  }
  return candidates[0];
}

/** Создаёт минимальный package.json временного Plugin runtime. */
async function writeRuntimeManifest(runtimeRoot) {
  const manifest = {
    private: true,
    type: "module",
    dependencies: {
      [CORE_PACKAGES.pluginSdk]: CORE_PACKAGE_VERSIONS.pluginSdk,
    },
  };
  await fs.writeFile(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

/** Читает JSON ordinary file внутри runtime и оборачивает ошибку Installer contract. */
async function readRuntimeJson(runtimeRoot, fileName) {
  const target = path.join(runtimeRoot, fileName);
  const stat = await lstatOrNull(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    invalid(`${fileName} должен быть обычным файлом Plugin runtime`);
  }
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    invalid(`${fileName} содержит некорректный JSON: ${error.message}`, { cause: error });
  }
}

/** Читает и проверяет installation receipt активного runtime. */
async function readRuntimeRecord(runtimeRoot) {
  return PluginInstallationRecord.parse(
    await readRuntimeJson(runtimeRoot, CORE_SERVICE_PATHS.pluginRuntimeRecord),
  );
}

/** Immutable успешно активированная Plugin installation. */
export class PluginInstallation {
  #loadedPlugin;
  #record;
  #reused;
  #runtimeRoot;
  #source;

  constructor({ loadedPlugin, record, reused, runtimeRoot, source } = {}, token) {
    if (
      token !== INSTALLATION_CONSTRUCTION ||
      !loadedPlugin ||
      typeof loadedPlugin.id !== "string" ||
      !(record instanceof PluginInstallationRecord) ||
      record.pluginId !== loadedPlugin.id ||
      typeof reused !== "boolean" ||
      typeof runtimeRoot !== "string" ||
      !path.isAbsolute(runtimeRoot) ||
      !(source instanceof PluginSource)
    ) {
      invalid("используйте StorePluginInstaller.install");
    }
    this.#loadedPlugin = loadedPlugin;
    this.#record = record;
    this.#reused = reused;
    this.#runtimeRoot = runtimeRoot;
    this.#source = source;
    Object.freeze(this);
  }

  get id() { return this.#loadedPlugin.id; }
  get version() { return this.#loadedPlugin.package.version; }
  get loadedPlugin() { return this.#loadedPlugin; }
  get record() { return this.#record; }
  get reused() { return this.#reused; }
  get runtimeRoot() { return this.#runtimeRoot; }
  get source() { return this.#source; }
}

/** Installer, уже привязанный к одному Store checkout. */
export class StorePluginInstaller {
  #checkout;
  #loader;
  #lock;
  #npmInstaller;

  constructor(
    storeCheckout,
    { loader = pluginLoader, lock = locks, npmInstaller = npmPackageInstaller } = {},
  ) {
    assertStoreCheckout(storeCheckout);
    if (typeof loader?.load !== "function") invalid("loader должен предоставлять load");
    if (typeof lock?.run !== "function") invalid("lock должен предоставлять run");
    if (typeof npmInstaller?.install !== "function") {
      invalid("npmInstaller должен предоставлять install");
    }
    this.#checkout = storeCheckout;
    this.#loader = loader;
    this.#lock = lock;
    this.#npmInstaller = npmInstaller;
    Object.freeze(this);
  }

  /** Materialize, validate и atomically activate один внешний Plugin runtime. */
  async install(pluginId, source) {
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
    }
    if (!(source instanceof PluginSource) || !source.installable) {
      invalid("требуется installable PluginSource");
    }
    await ensureDirectories(this.#checkout.root, CORE_SERVICE_PATHS.lockDirectory);
    const storeRoot = await fs.realpath(this.#checkout.root);
    return this.#lock.run(
      path.join(storeRoot, CORE_SERVICE_PATHS.pluginInstallerLock),
      () => this.#installUnlocked(storeRoot, pluginId, source),
      { busyCode: "PLUGIN_INSTALL_BUSY" },
    );
  }

  async #installUnlocked(storeRoot, pluginId, source) {
    const pluginDirectory = await ensureDirectories(
      storeRoot,
      path.posix.join(CORE_SERVICE_PATHS.pluginRuntimeDirectory, pluginId),
    );
    let temporary = await fs.mkdtemp(path.join(pluginDirectory, ".install-"));
    try {
      await writeRuntimeManifest(temporary);
      await this.#npmInstaller.install({ source, runtimeRoot: temporary });
      const packageName = await discoverPackageName(temporary, source);
      const temporaryPackageRoot = packageRoot(temporary, packageName);
      const candidate = await this.#loader.load({ packageRoot: temporaryPackageRoot, pluginId });
      if (candidate.package.name !== packageName) {
        invalid(`ожидался package ${packageName}, установлен ${candidate.package.name}`);
      }
      const record = PluginInstallationRecord.create({
        pluginId,
        loadedPlugin: candidate,
        source,
        packageLock: await readRuntimeJson(temporary, "package-lock.json"),
      });
      await fs.writeFile(
        path.join(temporary, CORE_SERVICE_PATHS.pluginRuntimeRecord),
        `${JSON.stringify(record.toJSON(), null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      const target = path.join(pluginDirectory, candidate.package.version);
      const existing = await lstatOrNull(target);
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          invalid(`активный runtime ${pluginId}@${candidate.package.version} повреждён`);
        }
        const activePackageName = await discoverPackageName(target, source);
        const active = await this.#loader.load({
          packageRoot: packageRoot(target, activePackageName),
          pluginId,
        });
        if (
          active.package.name !== candidate.package.name ||
          active.package.version !== candidate.package.version
        ) {
          invalid(`активный runtime ${pluginId}@${candidate.package.version} имеет другую identity`);
        }
        const activeRecord = await readRuntimeRecord(target);
        if (!activeRecord.equals(record)) {
          invalid(`активный runtime ${pluginId}@${candidate.package.version} имеет другой receipt`);
        }
        return new PluginInstallation({
          loadedPlugin: active,
          record: activeRecord,
          reused: true,
          runtimeRoot: target,
          source,
        }, INSTALLATION_CONSTRUCTION);
      }
      await fs.rename(temporary, target);
      temporary = null;
      try {
        const active = await this.#loader.load({
          packageRoot: packageRoot(target, packageName),
          pluginId,
        });
        if (
          active.package.name !== candidate.package.name ||
          active.package.version !== candidate.package.version
        ) {
          invalid(`активированный runtime ${pluginId}@${candidate.package.version} изменил identity`);
        }
        return new PluginInstallation({
          loadedPlugin: active,
          record,
          reused: false,
          runtimeRoot: target,
          source,
        }, INSTALLATION_CONSTRUCTION);
      } catch (error) {
        await fs.rm(target, { recursive: true, force: true });
        throw error;
      }
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}

/** Factory Store-scoped Plugin Installer. */
export class PluginInstallerService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  /** Создаёт Installer для проверенного Store checkout. */
  forStore(storeCheckout) {
    return new StorePluginInstaller(storeCheckout, this.#dependencies);
  }
}

/** Общий Plugin Installer Service нового Core. */
export const pluginInstallers = Object.freeze(new PluginInstallerService());
