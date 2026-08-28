/** @fileoverview Безопасная загрузка установленного ESM Plugin entrypoint. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PluginPackage } from "@openspec-orch/plugin-sdk";

import { CORE_PATTERNS } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { isContainedPath } from "./path.js";

const PLUGIN_API_METHODS = Object.freeze([
  "supportsRole",
  "assertSupports",
  "hasRepositoryContribution",
  "connect",
  "status",
  "canSync",
  "sync",
  "canExec",
  "exec",
  "hasExtensionContribution",
  "extensions",
  "hasCommandContribution",
  "registerCommands",
]);
const REPOSITORY_ROLES = new Set(["store", "code"]);

/** Завершает загрузку стабильной ошибкой Core Plugin Loader. */
function invalid(message, options) {
  throw new Error(`PLUGIN_LOAD_INVALID: ${message}`, options);
}

/** Независимо проверяет структурный публичный API Plugin export. */
function assertPluginExport(plugin) {
  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
    invalid("default export должен быть Plugin object");
  }
  if (typeof plugin.id !== "string" || !CORE_PATTERNS.pluginId.test(plugin.id)) {
    invalid("Plugin export id должен быть lowercase kebab-case");
  }
  if (!Array.isArray(plugin.supports)) {
    invalid("Plugin export supports должен быть массивом");
  }
  if (plugin.supports.some((role) => !REPOSITORY_ROLES.has(role))) {
    invalid("Plugin export supports содержит неизвестную Repository role");
  }
  if (new Set(plugin.supports).size !== plugin.supports.length) {
    invalid("Plugin export supports содержит повторяющуюся role");
  }
  if (!Object.isFrozen(plugin) || !Object.isFrozen(plugin.supports)) {
    invalid("Plugin export и supports должны быть immutable");
  }
  for (const method of PLUGIN_API_METHODS) {
    if (typeof plugin[method] !== "function") {
      invalid(`Plugin export не предоставляет метод ${method}`);
    }
  }
}

/** Проверяет ordinary file/directory chain внутри канонического package root. */
async function requirePackagePath(packageRoot, relativePath) {
  let current = packageRoot;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) invalid(`отсутствует ${relativePath}`);
    if (stat.isSymbolicLink()) invalid(`${relativePath} содержит symlink`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) invalid(`${relativePath} проходит через файл`);
    if (final && !stat.isFile()) invalid(`${relativePath} должен быть обычным файлом`);
  }
  return current;
}

/** Immutable загруженная связка package contract и Plugin export. */
export class LoadedPlugin {
  #root;
  #entrypoint;
  #package;
  #plugin;

  constructor({ root, entrypoint, pluginPackage, plugin } = {}) {
    if (
      typeof root !== "string" ||
      typeof entrypoint !== "string" ||
      !path.isAbsolute(root) ||
      !path.isAbsolute(entrypoint)
    ) {
      throw new Error("LOADED_PLUGIN_INVALID: root и entrypoint должны быть абсолютными путями");
    }
    if (!isContainedPath(root, entrypoint)) {
      throw new Error("LOADED_PLUGIN_INVALID: entrypoint должен находиться внутри package root");
    }
    if (!(pluginPackage instanceof PluginPackage)) {
      throw new Error("LOADED_PLUGIN_INVALID: требуется проверенный PluginPackage");
    }
    assertPluginExport(plugin);
    this.#root = root;
    this.#entrypoint = entrypoint;
    this.#package = pluginPackage;
    this.#plugin = plugin;
    Object.freeze(this);
  }

  get id() { return this.#plugin.id; }
  get supports() { return this.#plugin.supports; }
  get root() { return this.#root; }
  get entrypoint() { return this.#entrypoint; }
  get package() { return this.#package; }
  get plugin() { return this.#plugin; }
}

/** Валидирует package до import и не выполняет Plugin contributions. */
export class PluginLoader {
  #importModule;

  constructor(importModule = (specifier) => import(specifier)) {
    if (typeof importModule !== "function") {
      throw new Error("PLUGIN_LOADER_INVALID: importModule должен быть функцией");
    }
    this.#importModule = importModule;
    Object.freeze(this);
  }

  async load({ packageRoot, pluginId } = {}) {
    if (typeof packageRoot !== "string" || !path.isAbsolute(packageRoot)) {
      invalid("packageRoot должен быть абсолютным путём");
    }
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid("ожидаемый pluginId должен быть lowercase kebab-case");
    }
    const rootStat = await lstatOrNull(packageRoot);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      invalid("packageRoot должен быть существующим обычным каталогом");
    }
    const root = await fs.realpath(packageRoot);
    const manifestPath = await requirePackagePath(root, "package.json");
    let manifestSource;
    try {
      manifestSource = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
      invalid(`не удалось прочитать package.json: ${error.message}`, { cause: error });
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestSource);
    } catch (error) {
      invalid(`package.json содержит некорректный JSON: ${error.message}`, { cause: error });
    }
    const pluginPackage = new PluginPackage(manifest);
    const entrypoint = await requirePackagePath(root, pluginPackage.entrypoint.slice(2));
    let namespace;
    try {
      namespace = await this.#importModule(pathToFileURL(entrypoint).href);
    } catch (error) {
      invalid(`не удалось импортировать ${pluginPackage.name}: ${error.message}`, { cause: error });
    }
    const plugin = namespace?.default;
    assertPluginExport(plugin);
    if (plugin.id !== pluginId) {
      invalid(`ожидался plugin-id ${pluginId}, entrypoint экспортировал ${plugin.id}`);
    }
    return new LoadedPlugin({ root, entrypoint, pluginPackage, plugin });
  }
}

/** Общий Plugin Loader нового Core. */
export const pluginLoader = Object.freeze(new PluginLoader());
