/** @fileoverview Discovery и безопасное локальное хранение Plugin packages. */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import pacote from "pacote";
import { parse } from "yaml";

import { lstatOrNull } from "../shared/files.js";
import { runCommand } from "../shared/command.js";
import { isPortableRelativePath } from "../shared/paths.js";
import {
  DISTRIBUTION_PACKAGE_FILE,
  INSTALLED_PLUGIN_RELATIVE_ROOT,
  PLUGIN_DESCRIPTOR_FILE,
  PLUGIN_INSTALLATION_FILE,
  PLUGIN_PACKAGE_API_VERSION,
  PLUGIN_PACKAGE_FILE,
} from "./constants.js";
import {
  parsePluginDescriptor,
  parsePluginInstallation,
  parsePluginPackageManifest,
} from "./contract.js";

const require = createRequire(import.meta.url);

/**
 * Проверяет каталог без symlink и возвращает canonical path.
 *
 * @param {string} candidate Запрошенный каталог.
 * @param {string} label Название источника.
 * @returns {Promise<string>} Канонический путь.
 */
async function resolveDirectory(candidate, label) {
  const absolute = path.resolve(candidate);
  const stat = await lstatOrNull(absolute);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} должен быть существующим обычным каталогом: ${absolute}`);
  }
  return fs.realpath(absolute);
}

/** Читает и валидирует один Plugin package. */
export async function readPluginPackage(pluginRoot) {
  const root = await resolveDirectory(pluginRoot, "Plugin root");
  const packagePath = path.join(root, PLUGIN_PACKAGE_FILE);
  const descriptorPath = path.join(root, PLUGIN_DESCRIPTOR_FILE);
  for (const requiredPath of [packagePath, descriptorPath]) {
    const stat = await lstatOrNull(requiredPath);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_INVALID: отсутствует обычный ${path.basename(requiredPath)}: ${root}`);
    }
  }
  let packageValue;
  let descriptorValue;
  try {
    packageValue = JSON.parse(await fs.readFile(packagePath, "utf8"));
    descriptorValue = parse(await fs.readFile(descriptorPath, "utf8"));
  } catch (error) {
    throw new Error(`PLUGIN_INVALID: ${root}: ${error.message}`);
  }
  const packageManifest = parsePluginPackageManifest(packageValue, packagePath);
  const descriptor = parsePluginDescriptor(descriptorValue, descriptorPath);
  if (descriptor.version !== packageManifest.version) {
    throw new Error(
      `PLUGIN_VERSION_MISMATCH: ${descriptor.id} descriptor ${descriptor.version} ` +
        `не совпадает с package ${packageManifest.version}`,
    );
  }
  if (packageManifest.openspecOrchestrator.entrypoint) {
    const entrypoint = path.join(root, packageManifest.openspecOrchestrator.entrypoint);
    const stat = await lstatOrNull(entrypoint);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(`PLUGIN_PACKAGE_INVALID: отсутствует обычный entrypoint: ${entrypoint}`);
    }
  }
  return { root, descriptor, packageManifest };
}

/**
 * Находит Plugin packages в одном источнике.
 *
 * @param {string} sourceRoot Источник discovery.
 * @returns {Promise<Array<{root: string, descriptor: ReturnType<typeof parsePluginDescriptor>}>>}
 */
async function discoverSource(sourceRoot) {
  const root = await resolveDirectory(sourceRoot, "Plugin source");
  if (await lstatOrNull(path.join(root, PLUGIN_DESCRIPTOR_FILE))) {
    return [{ ...await readPluginPackage(root), sourceSpec: root, sourceKind: "directory" }];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const packages = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    if (await lstatOrNull(path.join(candidate, PLUGIN_DESCRIPTOR_FILE))) {
      packages.push({
        ...await readPluginPackage(candidate),
        sourceSpec: candidate,
        sourceKind: "directory",
      });
    }
  }
  return packages;
}

/** Загружает один npm-compatible package spec только для discovery metadata. */
async function discoverPackageSpec(sourceSpec) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-source-"));
  try {
    await pacote.extract(sourceSpec, temporaryRoot, { ignoreScripts: true });
    return [{ ...await readPluginPackage(temporaryRoot), sourceSpec, sourceKind: "package" }];
  } catch (error) {
    throw new Error(`PLUGIN_SOURCE_INVALID: ${sourceSpec}: ${error.message}`, { cause: error });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

/** Различает локальный catalog directory и npm-compatible package spec. */
async function discoverExternalSource(sourceSpec) {
  const stat = await lstatOrNull(path.resolve(sourceSpec));
  return stat?.isDirectory() && !stat.isSymbolicLink()
    ? discoverSource(sourceSpec)
    : discoverPackageSpec(sourceSpec);
}

/** Разрешает явно объявленные Plugin packages стандартной поставки. */
async function discoverBundledPlugins() {
  let distribution;
  try {
    distribution = JSON.parse(await fs.readFile(DISTRIBUTION_PACKAGE_FILE, "utf8"));
  } catch (error) {
    throw new Error(`PLUGIN_DISTRIBUTION_INVALID: ${DISTRIBUTION_PACKAGE_FILE}: ${error.message}`);
  }
  const packageNames = distribution.openspecOrchestrator?.bundledPlugins;
  if (!Array.isArray(packageNames) || packageNames.some((name) => typeof name !== "string" || !name)) {
    throw new Error("PLUGIN_DISTRIBUTION_INVALID: bundledPlugins должен быть массивом package names");
  }
  return Promise.all(packageNames.map(async (packageName) => {
    let packageRoot;
    try {
      packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
    } catch (error) {
      throw new Error(
        `PLUGIN_PACKAGE_UNAVAILABLE: пакет стандартной поставки '${packageName}' не установлен`,
        { cause: error },
      );
    }
    const plugin = await readPluginPackage(packageRoot);
    if (plugin.packageManifest.name !== packageName) {
      throw new Error(
        `PLUGIN_PACKAGE_INVALID: ожидался ${packageName}, получен ${plugin.packageManifest.name}`,
      );
    }
    return {
      ...plugin,
      sourceSpec: packageRoot,
      sourceKind: "directory",
      installation: {
        apiVersion: PLUGIN_PACKAGE_API_VERSION,
        kind: "bundled",
        packageName,
      },
    };
  }));
}

/** Обнаруживает встроенные и явно переданные пользовательские Plugins. */
export async function discoverPlugins(sourceRoots = []) {
  const discovered = await discoverBundledPlugins();
  const ids = new Set();
  for (const plugin of discovered) ids.add(plugin.descriptor.id);
  for (const sourceSpec of sourceRoots) {
    for (const plugin of await discoverExternalSource(sourceSpec)) {
      if (ids.has(plugin.descriptor.id)) {
        throw new Error(`PLUGIN_DUPLICATE: повторяющийся plugin-id ${plugin.descriptor.id}`);
      }
      ids.add(plugin.descriptor.id);
      discovered.push({
        ...plugin,
        installation: {
          apiVersion: PLUGIN_PACKAGE_API_VERSION,
          kind: "local",
        },
      });
    }
  }
  return discovered;
}

/**
 * Проверяет materialized package tree до установки dependencies.
 *
 * @param {string} packageRoot Materialized Plugin Package.
 * @returns {Promise<void>}
 */
async function validatePackageTree(packageRoot) {
  const walk = async (relativeRoot = ".") => {
    const current = relativeRoot === "." ? packageRoot : path.join(packageRoot, relativeRoot);
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (relativeRoot === "." && entry.name === PLUGIN_INSTALLATION_FILE) {
        throw new Error(`PLUGIN_INVALID: ${PLUGIN_INSTALLATION_FILE} зарезервирован Orchestrator`);
      }
      const relativePath = relativeRoot === "." ? entry.name : path.join(relativeRoot, entry.name);
      const normalized = relativePath.split(path.sep).join("/");
      if (!isPortableRelativePath(normalized, { allowDot: false })) {
        throw new Error(`PLUGIN_INVALID: небезопасный путь ${normalized}`);
      }
      const target = path.join(packageRoot, relativePath);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new Error(`PLUGIN_INVALID: symlink запрещён: ${normalized}`);
      if (stat.isDirectory()) await walk(relativePath);
      else if (!stat.isFile()) throw new Error(`PLUGIN_INVALID: специальный файл запрещён: ${normalized}`);
    }
  };
  await walk();
}

/** Копирует проверяемый локальный package directory без node_modules. */
async function copyDirectoryPackage(sourceRoot, targetRoot) {
  const walk = async (relativeRoot = ".") => {
    const source = relativeRoot === "." ? sourceRoot : path.join(sourceRoot, relativeRoot);
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (relativeRoot === "." && entry.name === "node_modules") continue;
      const relativePath = relativeRoot === "." ? entry.name : path.join(relativeRoot, entry.name);
      const sourcePath = path.join(sourceRoot, relativePath);
      const targetPath = path.join(targetRoot, relativePath);
      const stat = await fs.lstat(sourcePath);
      if (stat.isSymbolicLink()) throw new Error(`PLUGIN_INVALID: symlink запрещён: ${relativePath}`);
      if (stat.isDirectory()) {
        await fs.mkdir(targetPath, { mode: 0o700 });
        await walk(relativePath);
      } else if (stat.isFile()) {
        await fs.copyFile(sourcePath, targetPath);
      } else {
        throw new Error(`PLUGIN_INVALID: специальный файл запрещён: ${relativePath}`);
      }
    }
  };
  await walk();
}

/**
 * Атомарно materialize Plugin Package и его production dependencies в Store cache.
 *
 * @param {object} plugin Проверенный discovered Plugin Package.
 * @param {string} targetRoot Локальный cache target.
 * @param {typeof runCommand} packageInstaller Исполнитель npm install.
 * @returns {Promise<void>}
 */
async function materializePluginPackage(plugin, targetRoot, packageInstaller) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(path.dirname(targetRoot), `.${path.basename(targetRoot)}-`),
  );
  try {
    if (plugin.sourceKind === "directory") {
      await copyDirectoryPackage(plugin.sourceSpec, temporaryRoot);
    } else {
      await pacote.extract(plugin.sourceSpec, temporaryRoot, { ignoreScripts: true });
    }
    await validatePackageTree(temporaryRoot);
    const materialized = await readPluginPackage(temporaryRoot);
    if (
      !isDeepStrictEqual(materialized.descriptor, plugin.descriptor) ||
      !isDeepStrictEqual(materialized.packageManifest, plugin.packageManifest)
    ) {
      throw new Error(`PLUGIN_PACKAGE_CHANGED: ${plugin.descriptor.id} изменился после discovery`);
    }
    const dependencies = {
      ...plugin.packageManifest.dependencies,
      ...plugin.packageManifest.optionalDependencies,
    };
    if (plugin.installation.kind === "local" && Object.keys(dependencies).length > 0) {
      await packageInstaller(
        "npm",
        ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
        { cwd: temporaryRoot },
      );
    }
    await fs.writeFile(
      path.join(temporaryRoot, PLUGIN_INSTALLATION_FILE),
      `${JSON.stringify(plugin.installation, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryRoot, targetRoot);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

/** Проверяет каждый компонент Store-local Plugin cache, при необходимости создавая его. */
async function resolvePluginCacheRoot(storeRoot, create = false) {
  const canonicalStoreRoot = await fs.realpath(storeRoot);
  const segments = INSTALLED_PLUGIN_RELATIVE_ROOT.split(path.sep);
  let current = canonicalStoreRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`PLUGIN_CACHE_UNSAFE: cache path должен состоять из обычных каталогов: ${current}`);
      }
      continue;
    }
    if (!create) return path.join(canonicalStoreRoot, INSTALLED_PLUGIN_RELATIVE_ROOT);
    await fs.mkdir(current, { mode: 0o700 });
  }
  return current;
}

/** Возвращает проверенный cache root одного установленного Plugin. */
async function installedPluginRoot(storeRoot, pluginId, createCache = false) {
  return path.join(await resolvePluginCacheRoot(storeRoot, createCache), pluginId);
}

/** Читает установленный descriptor и подтверждает identity каталога. */
export async function readInstalledPluginPackage(storeRoot, pluginId) {
  const root = await installedPluginRoot(storeRoot, pluginId);
  const stat = await lstatOrNull(root);
  if (!stat) {
    throw new Error(`PLUGIN_NOT_INITIALIZED: plugin-id '${pluginId}' не установлен локально`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`PLUGIN_CACHE_UNSAFE: Plugin cache должен быть обычным каталогом: ${root}`);
  }
  const plugin = await readPluginPackage(root);
  const installationPath = path.join(root, PLUGIN_INSTALLATION_FILE);
  let installation;
  try {
    installation = parsePluginInstallation(
      JSON.parse(await fs.readFile(installationPath, "utf8")),
      installationPath,
    );
  } catch (error) {
    if (error.message.startsWith("PLUGIN_INSTALLATION_INVALID:")) throw error;
    throw new Error(`PLUGIN_INSTALLATION_INVALID: ${installationPath}: ${error.message}`);
  }
  const { descriptor } = plugin;
  if (descriptor.id !== pluginId) {
    throw new Error(`PLUGIN_ID_MISMATCH: cache ${pluginId} содержит descriptor ${descriptor.id}`);
  }
  return { ...plugin, installation };
}

/** Читает descriptor установленного Plugin для совместимых catalog callers. */
export async function readInstalledPlugin(storeRoot, pluginId) {
  return (await readInstalledPluginPackage(storeRoot, pluginId)).descriptor;
}

/** Устанавливает один пакет либо подтверждает идентичный descriptor. */
export async function installPluginPackage(storeRoot, plugin, packageInstaller = runCommand) {
  const target = await installedPluginRoot(storeRoot, plugin.descriptor.id, true);
  if (await lstatOrNull(target)) {
    const installed = await readInstalledPluginPackage(storeRoot, plugin.descriptor.id);
    if (
      !isDeepStrictEqual(installed.descriptor, plugin.descriptor) ||
      !isDeepStrictEqual(installed.packageManifest, plugin.packageManifest) ||
      !isDeepStrictEqual(installed.installation, plugin.installation)
    ) {
      throw new Error(
        `PLUGIN_VERSION_MISMATCH: ${plugin.descriptor.id} уже установлен с другим package contract`,
      );
    }
    return "already_initialized";
  }
  await materializePluginPackage(plugin, target, packageInstaller);
  return "initialized";
}

/** Удаляет локальный cache одного Plugin. */
export async function removeInstalledPlugin(storeRoot, pluginId) {
  const target = await installedPluginRoot(storeRoot, pluginId);
  const stat = await lstatOrNull(target);
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) {
    throw new Error(`PLUGIN_CACHE_UNSAFE: Plugin cache должен быть обычным каталогом: ${target}`);
  }
  await fs.rm(target, { recursive: true, force: true });
}
