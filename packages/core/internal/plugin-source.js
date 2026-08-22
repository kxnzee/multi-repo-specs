/** @fileoverview Доменная модель явно зафиксированного источника Plugin package. */

import path from "node:path";
import process from "node:process";

import parsePackageArgument from "npm-package-arg";

import { CORE_PATTERNS } from "./constants.js";
import { isPortableRelativePath } from "./path.js";

const SOURCE_CONSTRUCTION = Symbol("PluginSource construction");

/** Завершает разбор стабильной ошибкой домена Plugin source. */
function invalid(message, options) {
  throw new Error(`PLUGIN_SOURCE_INVALID: ${message}`, options);
}

/** Запрещает credentials в URL, который может попасть в diagnostics или lock. */
function assertNoWebCredentials(specifier) {
  let url;
  try {
    url = new URL(specifier.replace(/^git\+/, ""));
  } catch {
    return;
  }
  if (url.password || (["http:", "https:"].includes(url.protocol) && url.username)) {
    invalid("URL источника не должен содержать credentials");
  }
}

/** Проверяет точный npm package spec и возвращает разобранную модель. */
function exactPackage(specifier, cwd) {
  let parsed;
  try {
    parsed = parsePackageArgument(specifier, cwd);
  } catch (error) {
    invalid(`некорректный package spec: ${error.message}`, { cause: error });
  }
  if (["tag", "range", "alias"].includes(parsed.type)) {
    invalid("npm source должен содержать точную версию");
  }
  if (parsed.type === "git") {
    assertNoWebCredentials(parsed.fetchSpec ?? parsed.rawSpec);
    try {
      if (new URL(parsed.fetchSpec).protocol === "file:") {
        invalid("Git source должен быть remote URL, а не локальным путём");
      }
    } catch (error) {
      if (error.message.startsWith("PLUGIN_SOURCE_INVALID:")) throw error;
    }
    if (
      parsed.gitRange ||
      !CORE_PATTERNS.gitRevision.test((parsed.gitCommittish ?? "").toLowerCase())
    ) {
      invalid("Git source должен содержать полный commit SHA");
    }
  }
  if (parsed.type === "remote") assertNoWebCredentials(parsed.fetchSpec);
  return parsed;
}

/**
 * Immutable источник Plugin package до materialization и записи installation lock.
 * Допустимые production-источники уже pinned; local directory остаётся dev-only.
 */
export class PluginSource {
  #kind;
  #packageName;
  #installSpec;
  #declaration;
  #developmentOnly;

  constructor({ kind, packageName, installSpec, declaration, developmentOnly = false } = {}, token) {
    if (token !== SOURCE_CONSTRUCTION) {
      invalid("используйте PluginSource.parse или PluginSource.bundled");
    }
    this.#kind = kind;
    this.#packageName = packageName;
    this.#installSpec = installSpec;
    this.#declaration = declaration;
    this.#developmentOnly = developmentOnly;
    Object.freeze(this);
  }

  /** Разбирает пользовательский npm-compatible source без сетевого разрешения. */
  static parse(specifier, { cwd = process.cwd() } = {}) {
    if (typeof specifier !== "string" || specifier.trim() !== specifier || !specifier) {
      invalid("source должен быть непустой строкой без внешних пробелов");
    }
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
      invalid("cwd должен быть абсолютным путём");
    }
    const parsed = exactPackage(specifier, cwd);
    if (parsed.type === "version") {
      return new PluginSource({
        kind: "npm",
        packageName: parsed.name,
        installSpec: `${parsed.name}@${parsed.rawSpec}`,
        declaration: `${parsed.name}@${parsed.rawSpec}`,
      }, SOURCE_CONSTRUCTION);
    }
    if (parsed.type === "git") {
      return new PluginSource({
        kind: "git",
        packageName: parsed.name ?? null,
        installSpec: parsed.saveSpec ?? parsed.rawSpec,
        declaration: parsed.saveSpec ?? parsed.rawSpec,
      }, SOURCE_CONSTRUCTION);
    }
    if (parsed.type === "remote") {
      return new PluginSource({
        kind: "tarball",
        packageName: parsed.name ?? null,
        installSpec: parsed.fetchSpec,
        declaration: parsed.saveSpec ?? parsed.rawSpec,
      }, SOURCE_CONSTRUCTION);
    }
    if (parsed.type === "file") {
      const relative = parsed.saveSpec.startsWith("file:")
        ? parsed.saveSpec.slice("file:".length)
        : parsed.saveSpec;
      const portable = isPortableRelativePath(relative, { allowDot: false });
      return new PluginSource({
        kind: "tarball",
        packageName: parsed.name ?? null,
        installSpec: parsed.fetchSpec,
        declaration: portable ? parsed.saveSpec : "local",
        developmentOnly: !portable,
      }, SOURCE_CONSTRUCTION);
    }
    if (parsed.type === "directory") {
      return new PluginSource({
        kind: "local",
        packageName: parsed.name ?? null,
        installSpec: parsed.fetchSpec,
        declaration: "local",
        developmentOnly: true,
      }, SOURCE_CONSTRUCTION);
    }
    invalid(`source type ${parsed.type} не поддерживается`);
  }

  /** Создаёт источник bundled package из root distribution. */
  static bundled({ name, version } = {}) {
    const parsed = exactPackage(`${name}@${version}`, process.cwd());
    if (parsed.type !== "version") {
      invalid("bundled source должен содержать package name и точную version");
    }
    return new PluginSource({
      kind: "bundled",
      packageName: parsed.name,
      installSpec: null,
      declaration: `${parsed.name}@${parsed.rawSpec}`,
    }, SOURCE_CONSTRUCTION);
  }

  get kind() { return this.#kind; }
  get packageName() { return this.#packageName; }
  get installSpec() { return this.#installSpec; }
  get declaration() { return this.#declaration; }
  get developmentOnly() { return this.#developmentOnly; }
  get installable() { return this.#kind !== "bundled"; }
  get requiresInstallLinks() { return this.#kind === "local"; }
}
