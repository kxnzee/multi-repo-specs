/** @fileoverview Переносимый receipt одной установленной версии Plugin runtime. */

import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { CORE_CONTRACT_VERSIONS, CORE_PATTERNS } from "./constants.js";
import { isPortableRelativePath } from "./path.js";
import { PluginSource } from "./plugin-source.js";
import { deepFreeze, ownValue } from "./value.js";

const RECORD_CONSTRUCTION = Symbol("PluginInstallationRecord construction");
const SOURCE_KINDS = new Set(["bundled", "git", "local", "npm", "tarball"]);

/** Завершает проверку стабильной ошибкой installation record. */
function invalid(message, options) {
  throw new Error(`PLUGIN_INSTALLATION_INVALID: ${message}`, options);
}

/** Проверяет plain object с точным набором ключей. */
function assertObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} должен быть object`);
  }
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    invalid(`${label} содержит неизвестные или отсутствующие поля`);
  }
}

/** Проверяет npm package name через уже принятый source parser. */
function assertPackageName(name) {
  try {
    const parsed = PluginSource.parse(`${name}@0.0.0`, { cwd: path.resolve("/") });
    if (parsed.kind !== "npm" || parsed.packageName !== name) throw new Error("name mismatch");
  } catch (error) {
    invalid(`некорректный package name '${name ?? ""}'`, { cause: error });
  }
}

/** Возвращает package name из portable package-lock path. */
function nameFromPackagePath(packagePath) {
  if (
    !isPortableRelativePath(packagePath, { allowDot: false }) ||
    !packagePath.startsWith("node_modules/")
  ) {
    invalid(`небезопасный dependency path '${packagePath}'`);
  }
  const marker = "node_modules/";
  const tail = packagePath.slice(packagePath.lastIndexOf(marker) + marker.length);
  const segments = tail.split("/");
  const name = segments[0].startsWith("@")
    ? segments.length === 2 ? `${segments[0]}/${segments[1]}` : null
    : segments.length === 1 ? segments[0] : null;
  if (!name) invalid(`dependency path '${packagePath}' не заканчивается package name`);
  assertPackageName(name);
  return name;
}

/** Нормализует relationship map в детерминированный immutable object. */
function relationship(value, label) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} должен быть object`);
  }
  const normalized = {};
  for (const name of Object.keys(value).sort()) {
    assertPackageName(name);
    if (typeof value[name] !== "string" || !value[name]) {
      invalid(`${label}.${name} должен быть непустой строкой`);
    }
    normalized[name] = value[name];
  }
  return Object.freeze(normalized);
}

/** Удаляет machine-local resolved path и запрещает credentials. */
function portableResolved(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || /[\r\n]/.test(value)) {
    invalid("dependency resolved должен быть непустой однострочной строкой");
  }
  if (value.startsWith("file:") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return "local";
  }
  let url;
  try {
    url = new URL(value.replace(/^git\+/, ""));
  } catch {
    return value;
  }
  if (url.password || (["http:", "https:"].includes(url.protocol) && url.username)) {
    invalid("dependency resolved URL не должен содержать credentials");
  }
  if (value.startsWith("git+") && !CORE_PATTERNS.gitRevision.test(url.hash.slice(1).toLowerCase())) {
    invalid("Git dependency resolved должен содержать полный commit SHA");
  }
  return value;
}

/** Строит детерминированную проекцию установленного package-lock dependency tree. */
function projectDependencies(packageLock) {
  if (
    !packageLock ||
    typeof packageLock !== "object" ||
    Array.isArray(packageLock) ||
    packageLock.lockfileVersion !== 3 ||
    !packageLock.packages ||
    typeof packageLock.packages !== "object" ||
    Array.isArray(packageLock.packages)
  ) {
    invalid("npm package-lock должен использовать lockfileVersion 3 и packages object");
  }
  const dependencies = [];
  for (const packagePath of Object.keys(packageLock.packages).filter(Boolean).sort()) {
    const value = packageLock.packages[packagePath];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(`dependency ${packagePath} должна быть object`);
    }
    if (value.link === true || value.dev === true) {
      invalid(`dependency ${packagePath} не должна быть link или dev package`);
    }
    const name = value.name ?? nameFromPackagePath(packagePath);
    assertPackageName(name);
    if (name !== nameFromPackagePath(packagePath)) {
      invalid(`dependency ${packagePath} содержит другое package name ${name}`);
    }
    if (typeof value.version !== "string" || !CORE_PATTERNS.exactSemanticVersion.test(value.version)) {
      invalid(`dependency ${packagePath} должна содержать exact semantic version`);
    }
    const projected = {
      path: packagePath,
      name,
      version: value.version,
    };
    const resolved = portableResolved(value.resolved);
    if (resolved !== undefined) projected.resolved = resolved;
    if (value.integrity !== undefined) {
      if (typeof value.integrity !== "string" || !value.integrity || /[\r\n]/.test(value.integrity)) {
        invalid(`dependency ${packagePath} содержит некорректную integrity`);
      }
      projected.integrity = value.integrity;
    }
    for (const [sourceKey, targetKey] of [
      ["dependencies", "dependencies"],
      ["optionalDependencies", "optional_dependencies"],
      ["peerDependencies", "peer_dependencies"],
    ]) {
      const projectedRelationship = relationship(value[sourceKey], `${packagePath}.${sourceKey}`);
      if (projectedRelationship !== undefined) projected[targetKey] = projectedRelationship;
    }
    dependencies.push(deepFreeze(projected));
  }
  return Object.freeze(dependencies);
}

/** Проверяет и нормализует JSON-представление installation record. */
function normalizeRecord(value) {
  assertObject(
    value,
    ["record_version", "plugin_id", "source", "package", "dependencies"],
    "installation record",
  );
  if (value.record_version !== CORE_CONTRACT_VERSIONS.pluginInstallation) {
    invalid(`поддерживается record_version ${CORE_CONTRACT_VERSIONS.pluginInstallation}`);
  }
  if (typeof value.plugin_id !== "string" || !CORE_PATTERNS.pluginId.test(value.plugin_id)) {
    invalid("plugin_id должен быть lowercase kebab-case");
  }
  assertObject(value.source, ["kind", "spec"], "source");
  if (!SOURCE_KINDS.has(value.source.kind)) invalid(`неизвестный source kind ${value.source.kind}`);
  if (typeof value.source.spec !== "string" || !value.source.spec) {
    invalid("source.spec должен быть непустой строкой");
  }
  if (value.source.spec === "local" && value.source.kind !== "local") {
    invalid("source spec local должен иметь kind local");
  }
  if (value.source.kind === "local" && value.source.spec !== "local") {
    invalid("local source должен использовать переносимый spec local");
  }
  if (!["bundled", "local"].includes(value.source.kind)) {
    let parsed;
    try {
      parsed = PluginSource.parse(value.source.spec, { cwd: path.resolve("/") });
    } catch (error) {
      invalid(`source spec некорректен: ${error.message}`, { cause: error });
    }
    if (parsed.kind !== value.source.kind || parsed.declaration !== value.source.spec) {
      invalid("source kind и spec не согласованы");
    }
  }
  assertObject(value.package, ["name", "version", "plugin"], "package");
  assertPackageName(value.package.name);
  if (
    typeof value.package.version !== "string" ||
    !CORE_PATTERNS.exactSemanticVersion.test(value.package.version) ||
    typeof value.package.plugin !== "string" ||
    !value.package.plugin.startsWith("./") ||
    value.package.plugin.includes("\\") ||
    value.package.plugin.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    invalid("package identity некорректна");
  }
  if (!Array.isArray(value.dependencies)) invalid("dependencies должен быть массивом");
  const paths = new Set();
  const dependencies = value.dependencies.map((dependency) => {
    const optionalKeys = ["resolved", "integrity", "dependencies", "optional_dependencies", "peer_dependencies"]
      .filter((key) => dependency && Object.hasOwn(dependency, key));
    assertObject(dependency, ["path", "name", "version", ...optionalKeys], "dependency");
    const expectedName = nameFromPackagePath(dependency.path);
    if (dependency.name !== expectedName) invalid(`dependency ${dependency.path} имеет другое name`);
    if (paths.has(dependency.path)) invalid(`повторяющийся dependency path ${dependency.path}`);
    paths.add(dependency.path);
    if (
      typeof dependency.version !== "string" ||
      !CORE_PATTERNS.exactSemanticVersion.test(dependency.version)
    ) {
      invalid(`dependency ${dependency.path} содержит некорректную version`);
    }
    const normalized = {
      path: dependency.path,
      name: dependency.name,
      version: dependency.version,
    };
    const resolved = portableResolved(dependency.resolved);
    if (resolved !== undefined) normalized.resolved = resolved;
    if (dependency.integrity !== undefined) {
      if (
        typeof dependency.integrity !== "string" ||
        !dependency.integrity ||
        /[\r\n]/.test(dependency.integrity)
      ) {
        invalid(`dependency ${dependency.path} содержит некорректную integrity`);
      }
      normalized.integrity = dependency.integrity;
    }
    for (const key of ["dependencies", "optional_dependencies", "peer_dependencies"]) {
      const normalizedRelationship = relationship(dependency[key], `${dependency.path}.${key}`);
      if (normalizedRelationship !== undefined) normalized[key] = normalizedRelationship;
    }
    return deepFreeze(normalized);
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (!dependencies.some(
    (dependency) => dependency.name === value.package.name && dependency.version === value.package.version,
  )) {
    invalid("dependency tree не содержит установленный Plugin package");
  }
  return deepFreeze({
    record_version: value.record_version,
    plugin_id: value.plugin_id,
    source: { ...value.source },
    package: { ...value.package },
    dependencies,
  });
}

/** Immutable переносимая identity и dependency tree одной Plugin installation. */
export class PluginInstallationRecord {
  #value;

  constructor(value, token) {
    if (token !== RECORD_CONSTRUCTION) invalid("используйте create или parse");
    this.#value = normalizeRecord(value);
    Object.freeze(this);
  }

  /** Создаёт receipt из проверенного Plugin, source и npm package-lock. */
  static create({ pluginId, loadedPlugin, source, packageLock } = {}) {
    if (
      !loadedPlugin ||
      loadedPlugin.id !== pluginId ||
      typeof loadedPlugin.package?.identity !== "function" ||
      !(source instanceof PluginSource)
    ) {
      invalid("требуются согласованные pluginId, LoadedPlugin и PluginSource");
    }
    const sourceKind = source.declaration === "local" ? "local" : source.kind;
    return new PluginInstallationRecord({
      record_version: CORE_CONTRACT_VERSIONS.pluginInstallation,
      plugin_id: pluginId,
      source: { kind: sourceKind, spec: source.declaration },
      package: loadedPlugin.package.identity(),
      dependencies: projectDependencies(packageLock),
    }, RECORD_CONSTRUCTION);
  }

  /** Восстанавливает и строго валидирует record из JSON. */
  static parse(value) {
    return new PluginInstallationRecord(value, RECORD_CONSTRUCTION);
  }

  get pluginId() { return this.#value.plugin_id; }
  get packageName() { return this.#value.package.name; }
  get version() { return this.#value.package.version; }
  get source() { return this.#value.source; }
  get dependencies() { return this.#value.dependencies; }

  equals(other) {
    return other instanceof PluginInstallationRecord &&
      isDeepStrictEqual(this.#value, other.#value);
  }

  toJSON() {
    return ownValue(this.#value);
  }
}
