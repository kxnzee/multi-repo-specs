/** @fileoverview Единый Store-scoped facade установки и загрузки Plugin packages. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { bundledPlugins } from "./bundled-plugin.js";
import {
  CORE_PACKAGES,
  CORE_PACKAGE_VERSIONS,
  CORE_PATTERNS,
  CORE_SERVICE_PATHS,
} from "./constants.js";
import { locks } from "./lock.js";
import { npmPackageInstaller } from "./npm-package-installer.js";
import { createPluginInstallation } from "./plugin-installation.js";
import { pluginLoader } from "./plugin-loader.js";
import { PluginDeclaration } from "./plugin-declaration.js";
import { PluginSource } from "./plugin-source.js";

/** Завершает операцию стабильной ошибкой Plugin Manager. */
function invalid(message, options) {
  throw new Error(`PLUGIN_MANAGER_INVALID: ${message}`, options);
}

/** Сообщает, что объявленный Plugin нужно снова инициализировать на этой машине. */
function unavailable(message, options) {
  throw Object.assign(
    new Error(`PLUGIN_RUNTIME_UNAVAILABLE: ${message}`, options),
    { code: "PLUGIN_RUNTIME_UNAVAILABLE" },
  );
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

/** Создаёт безопасную цепочку Core-owned каталогов. */
async function ensureDirectories(root, relativePath) {
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    invalid("Store root должен быть существующим обычным каталогом");
  }
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const existing = await lstatOrNull(current);
    if (!existing) await fs.mkdir(current, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalid(`${relativePath} содержит небезопасный directory segment`);
    }
  }
  return current;
}

/** Читает существующую цепочку каталогов без мутаций. */
async function requireDirectory(root, relativePath, { optional = false } = {}) {
  const rootStat = await lstatOrNull(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    invalid("Store root должен быть существующим обычным каталогом");
  }
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

/** Проверяет Store checkout до package operation. */
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

/** Возвращает node_modules root проверенного package name. */
function packageRoot(runtimeRoot, packageName) {
  const segments = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some((segment) => !segment || segment === "@" || segment.includes("\\"))
  ) {
    invalid(`npm создал некорректное package name '${packageName}'`);
  }
  return path.join(runtimeRoot, "node_modules", ...segments);
}

/** Находит единственный Plugin package в стандартном npm runtime manifest. */
async function runtimePackageName(runtimeRoot) {
  const target = path.join(runtimeRoot, "package.json");
  const stat = await lstatOrNull(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    invalid("runtime package.json должен быть обычным файлом");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    invalid(`runtime package.json повреждён: ${error.message}`, { cause: error });
  }
  const dependencies = manifest.dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    invalid("runtime package.json не содержит dependencies");
  }
  const names = Object.keys(dependencies).filter((name) => name !== CORE_PACKAGES.pluginSdk);
  if (names.length !== 1) invalid("runtime должен содержать ровно один Plugin package");
  return names[0];
}

/** Создаёт минимальный npm runtime manifest с SDK dependency. */
async function writeRuntimeManifest(runtimeRoot) {
  const manifest = {
    private: true,
    type: "module",
    dependencies: { [CORE_PACKAGES.pluginSdk]: CORE_PACKAGE_VERSIONS.pluginSdk },
  };
  await fs.writeFile(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

/** Один facade владеет materialization, resolution и removal Store-local runtime. */
export class StorePluginManager {
  #bundled;
  #checkout;
  #loader;
  #lock;
  #npmInstaller;

  constructor(
    storeCheckout,
    {
      bundledProvider = bundledPlugins,
      loader = pluginLoader,
      lock = locks,
      npmInstaller = npmPackageInstaller,
    } = {},
  ) {
    assertStoreCheckout(storeCheckout);
    if (
      typeof bundledProvider?.has !== "function" ||
      typeof bundledProvider?.install !== "function" ||
      typeof loader?.load !== "function" ||
      typeof lock?.run !== "function" ||
      typeof npmInstaller?.install !== "function"
    ) {
      invalid("требуются bundled provider, loader, lock и npm installer");
    }
    this.#bundled = bundledProvider;
    this.#checkout = storeCheckout;
    this.#loader = loader;
    this.#lock = lock;
    this.#npmInstaller = npmInstaller;
    Object.freeze(this);
  }

  async install(pluginId, source) {
    this.#assertInput(pluginId, source);
    if (source.kind === "bundled") return this.#bundled.install(pluginId, source);
    await ensureDirectories(this.#checkout.root, CORE_SERVICE_PATHS.lockDirectory);
    return this.#lock.run(
      path.join(this.#checkout.root, CORE_SERVICE_PATHS.pluginInstallerLock),
      async () => {
        const runtimeDirectory = await ensureDirectories(
          this.#checkout.root,
          CORE_SERVICE_PATHS.pluginRuntimeDirectory,
        );
        return this.#installExternal(runtimeDirectory, pluginId, source);
      },
      { busyCode: "PLUGIN_INSTALL_BUSY" },
    );
  }

  async resolve(declaration) {
    if (!(declaration instanceof PluginDeclaration)) invalid("требуется PluginDeclaration");
    if (this.#bundled.has(declaration.id, declaration.source)) {
      return this.#bundled.resolve(declaration);
    }
    const runtimeDirectory = await requireDirectory(
      this.#checkout.root,
      CORE_SERVICE_PATHS.pluginRuntimeDirectory,
      { optional: true },
    );
    if (!runtimeDirectory) unavailable(`${declaration.id}: runtime не установлен`);
    const runtimeRoot = path.join(runtimeDirectory, declaration.id);
    const stat = await lstatOrNull(runtimeRoot);
    if (!stat) unavailable(`${declaration.id}: runtime не установлен`);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      invalid(`${declaration.id}: runtime должен быть безопасным каталогом`);
    }
    const loadedPlugin = await this.#loadExternal(runtimeRoot, declaration.id);
    const installation = createPluginInstallation({
      loadedPlugin,
      runtimeRoot,
      source: PluginSource.parse(declaration.source, { cwd: this.#checkout.root }),
    });
    if (installation.declaration !== declaration.source) {
      invalid(`${declaration.id}: package identity не совпадает с project declaration`);
    }
    return installation;
  }

  async remove(pluginId) {
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
    }
    await ensureDirectories(this.#checkout.root, CORE_SERVICE_PATHS.lockDirectory);
    return this.#lock.run(
      path.join(this.#checkout.root, CORE_SERVICE_PATHS.pluginInstallerLock),
      async () => {
        const runtimeDirectory = await requireDirectory(
          this.#checkout.root,
          CORE_SERVICE_PATHS.pluginRuntimeDirectory,
          { optional: true },
        );
        if (!runtimeDirectory) return false;
        const target = path.join(runtimeDirectory, pluginId);
        const stat = await lstatOrNull(target);
        if (!stat) return false;
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          invalid(`${pluginId}: runtime должен быть безопасным каталогом`);
        }
        await fs.rm(target, { recursive: true });
        return true;
      },
      { busyCode: "PLUGIN_INSTALL_BUSY" },
    );
  }

  #assertInput(pluginId, source) {
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid(`некорректный plugin-id '${pluginId ?? ""}'`);
    }
    if (!(source instanceof PluginSource)) invalid("требуется PluginSource");
  }

  async #installExternal(runtimeDirectory, pluginId, source) {
    let temporary = await fs.mkdtemp(path.join(runtimeDirectory, `.install-${pluginId}-`));
    const target = path.join(runtimeDirectory, pluginId);
    let backup = null;
    try {
      await writeRuntimeManifest(temporary);
      await this.#npmInstaller.install({ source, runtimeRoot: temporary });
      const candidate = await this.#loadExternal(temporary, pluginId);
      const existing = await lstatOrNull(target);
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          invalid(`${pluginId}: runtime должен быть безопасным каталогом`);
        }
        backup = `${target}.previous-${randomUUID()}`;
        await fs.rename(target, backup);
      }
      await fs.rename(temporary, target);
      temporary = null;
      try {
        const loadedPlugin = await this.#loadExternal(target, pluginId);
        if (
          loadedPlugin.package.name !== candidate.package.name ||
          loadedPlugin.package.version !== candidate.package.version
        ) {
          invalid(`${pluginId}: package identity изменилась при активации`);
        }
        if (backup) await fs.rm(backup, { recursive: true });
        return createPluginInstallation({
          loadedPlugin,
          runtimeRoot: target,
          source,
        });
      } catch (error) {
        await fs.rm(target, { recursive: true, force: true });
        if (backup) await fs.rename(backup, target);
        backup = null;
        throw error;
      }
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
      if (backup) await fs.rm(backup, { recursive: true, force: true });
    }
  }

  async #loadExternal(runtimeRoot, pluginId) {
    const name = await runtimePackageName(runtimeRoot);
    return this.#loader.load({ packageRoot: packageRoot(runtimeRoot, name), pluginId });
  }
}

/** Composition factory единственного Store-scoped Plugin facade. */
export class PluginManagerService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  forStore(storeCheckout) {
    return new StorePluginManager(storeCheckout, this.#dependencies);
  }
}

export const pluginManagers = Object.freeze(new PluginManagerService());
