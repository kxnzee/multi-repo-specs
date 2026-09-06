/** @fileoverview Общий npm-backed package store для Plugins и Extensions. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { ensureDirectory, lstatOrNull } from "./fs.js";
import { locks } from "./lock.js";
import { npmPackageInstaller } from "./npm-package-installer.js";
import { isContainedPath } from "./path.js";

const KINDS = new Set(["extensions", "plugins"]);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

/** Завершает operation стабильной ошибкой package supply. */
function invalid(message, options) {
  throw new Error(`PACKAGE_SUPPLY_INVALID: ${message}`, options);
}

/** Сообщает об отсутствующем локальном runtime. */
function unavailable(message) {
  throw Object.assign(new Error(`PACKAGE_RUNTIME_UNAVAILABLE: ${message}`), {
    code: "PACKAGE_RUNTIME_UNAVAILABLE",
  });
}

/** Проверяет Store-scoped checkout. */
function assertCheckout(checkout) {
  if (
    checkout?.role !== "store" ||
    typeof checkout.root !== "string" ||
    typeof checkout.repository?.isStore !== "function" ||
    !checkout.repository.isStore()
  ) {
    invalid("требуется Store RepositoryCheckout");
  }
}

/** Проверяет domain key одного package. */
function assertRequest(kind, id) {
  if (!KINDS.has(kind)) invalid(`неизвестный package kind '${kind ?? ""}'`);
  if (typeof id !== "string" || !CORE_PATTERNS.id.test(id)) {
    invalid(`некорректный package id '${id ?? ""}'`);
  }
}

/** Проверяет непрозрачный npm-compatible source до передачи subprocess. */
function assertSource(source) {
  if (
    typeof source !== "string" ||
    !source ||
    source.trim() !== source ||
    /[\r\n\0]/u.test(source)
  ) {
    invalid("source должен быть непустой однострочной строкой без внешних пробелов");
  }
  try {
    const url = new URL(source.replace(/^git\+/u, ""));
    if (url.password || (["http:", "https:"].includes(url.protocol) && url.username)) {
      invalid("source URL не должен содержать credentials");
    }
  } catch (error) {
    if (error.message.startsWith("PACKAGE_SUPPLY_INVALID:")) throw error;
  }
}

/** Создаёт пустой private npm project manifest. */
function emptyManifest() {
  return {
    name: "openspec-orchestrator-packages",
    private: true,
    dependencies: {},
    openspecOrchestrator: { extensions: {}, plugins: {} },
  };
}

/** Проверяет принадлежащую Orchestrator часть package.json. */
function assertManifest(manifest) {
  const metadata = manifest?.openspecOrchestrator;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.private !== true ||
    (manifest.dependencies !== undefined && (
      !manifest.dependencies ||
      typeof manifest.dependencies !== "object" ||
      Array.isArray(manifest.dependencies)
    )) ||
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    invalid("package.json имеет несовместимый формат");
  }
  manifest.dependencies ??= {};
  for (const kind of KINDS) {
    if (!metadata[kind] || typeof metadata[kind] !== "object" || Array.isArray(metadata[kind])) {
      invalid(`package.json не содержит openspecOrchestrator.${kind}`);
    }
    for (const [id, packageName] of Object.entries(metadata[kind])) {
      if (!CORE_PATTERNS.id.test(id) || !PACKAGE_NAME.test(packageName)) {
        invalid(`package.json содержит некорректный mapping ${kind}/${id}`);
      }
      if (!Object.hasOwn(manifest.dependencies, packageName)) {
        invalid(`package.json mapping ${kind}/${id} не входит в dependencies`);
      }
    }
  }
  if (Object.entries(manifest.dependencies).some(([name, version]) => (
    !PACKAGE_NAME.test(name) || typeof version !== "string" || !version
  ))) {
    invalid("package.json содержит некорректные dependencies");
  }
  return manifest;
}

/** Возвращает стандартный node_modules path package. */
function packagePath(runtimeRoot, packageName) {
  if (!PACKAGE_NAME.test(packageName)) invalid(`некорректное npm package name '${packageName}'`);
  const segments = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some((segment) => !segment || segment === "@" || segment.includes("\\"))
  ) {
    invalid(`некорректное npm package name '${packageName}'`);
  }
  return path.join(runtimeRoot, "node_modules", ...segments);
}

/** Store-local npm project; npm owns dependency versions and lockfile. */
export class StorePackageSupply {
  #checkout;
  #installer;
  #lock;
  #writer;

  constructor(storeCheckout, {
    installer = npmPackageInstaller,
    lock = locks,
    writer = atomicWriter,
  } = {}) {
    assertCheckout(storeCheckout);
    if (
      typeof installer?.install !== "function" ||
      typeof installer?.remove !== "function" ||
      typeof installer?.sync !== "function" ||
      typeof lock?.run !== "function" ||
      typeof writer?.write !== "function"
    ) {
      invalid("требуются npm installer, lock и atomic writer");
    }
    this.#checkout = storeCheckout;
    this.#installer = installer;
    this.#lock = lock;
    this.#writer = writer;
    Object.freeze(this);
  }

  async install({ id, kind, publish = async () => {}, source, validate } = {}) {
    assertRequest(kind, id);
    assertSource(source);
    if (typeof validate !== "function" || typeof publish !== "function") {
      invalid("validate и publish должны быть functions");
    }
    return this.#withLock(async (runtimeRoot, existed) => {
      const snapshot = await this.#snapshot(runtimeRoot, existed);
      const current = existed ? await this.#readManifest(runtimeRoot) : null;
      if (current) await this.#assertLockedState(runtimeRoot, current);
      try {
        const before = current ?? await this.#readOrCreateManifest(runtimeRoot);
        const previousPackage = before.openspecOrchestrator[kind][id];
        const dependenciesBefore = new Set(Object.keys(before.dependencies));
        await this.#installer.install({ runtimeRoot, source });
        const installed = await this.#readManifest(runtimeRoot);
        const added = Object.keys(installed.dependencies)
          .filter((name) => !dependenciesBefore.has(name));
        const packageName = previousPackage ?? (added.length === 1 ? added[0] : undefined);
        if (!packageName || !Object.hasOwn(installed.dependencies, packageName)) {
          invalid("npm install должен добавить ровно один новый package");
        }
        if (previousPackage && added.some((name) => name !== previousPackage)) {
          invalid(`для замены package ${id} сначала удалите его`);
        }
        const value = await validate(await this.#requirePackageRoot(runtimeRoot, packageName));
        installed.openspecOrchestrator[kind][id] = packageName;
        await this.#writeManifest(runtimeRoot, installed);
        await publish(value);
        return value;
      } catch (error) {
        return this.#rollback(runtimeRoot, snapshot, error);
      }
    });
  }

  async resolve(kind, id) {
    assertRequest(kind, id);
    const runtimeRoot = this.#runtimeRoot();
    const runtimeStat = await lstatOrNull(runtimeRoot);
    if (!runtimeStat) unavailable(`${kind}/${id}: package runtime отсутствует`);
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
      invalid(`${CORE_SERVICE_PATHS.packageDirectory} должен быть безопасным каталогом`);
    }
    const manifest = await this.#readManifest(runtimeRoot, { optional: true });
    if (manifest) await this.#assertLockedState(runtimeRoot, manifest);
    const packageName = manifest?.openspecOrchestrator[kind][id];
    if (!packageName) unavailable(`${kind}/${id}: package не зарегистрирован`);
    if (!Object.hasOwn(manifest.dependencies, packageName)) {
      invalid(`${kind}/${id}: mapping не входит в dependencies`);
    }
    return Object.freeze({
      packageName,
      packageRoot: await this.#requirePackageRoot(runtimeRoot, packageName),
      runtimeRoot,
      version: manifest.dependencies[packageName],
    });
  }

  async remove(kind, id, publish = async () => {}) {
    assertRequest(kind, id);
    if (typeof publish !== "function") invalid("publish должен быть function");
    return this.#withLock(async (runtimeRoot, existed) => {
      if (!existed) {
        await publish();
        return false;
      }
      const manifest = await this.#readManifest(runtimeRoot);
      await this.#assertLockedState(runtimeRoot, manifest);
      const snapshot = await this.#snapshot(runtimeRoot, existed);
      try {
        const packageName = manifest?.openspecOrchestrator[kind][id];
        if (!packageName) {
          await publish();
          return false;
        }
        delete manifest.openspecOrchestrator[kind][id];
        const stillUsed = [...KINDS].some((currentKind) => (
          Object.values(manifest.openspecOrchestrator[currentKind]).includes(packageName)
        ));
        await this.#writeManifest(runtimeRoot, manifest);
        if (!stillUsed) await this.#installer.remove({ packageName, runtimeRoot });
        const updated = await this.#readManifest(runtimeRoot);
        updated.openspecOrchestrator = manifest.openspecOrchestrator;
        await this.#writeManifest(runtimeRoot, updated);
        await publish();
        return true;
      } catch (error) {
        return this.#rollback(runtimeRoot, snapshot, error);
      }
    }, { create: false });
  }

  async sync() {
    return this.#withLock(async (runtimeRoot, existed) => {
      if (!existed) return false;
      const manifest = await this.#readManifest(runtimeRoot);
      await this.#assertLockedState(runtimeRoot, manifest);
      await this.#installer.sync({ runtimeRoot });
      return true;
    }, { create: false });
  }

  async #withLock(operation, { create = true } = {}) {
    const lockRoot = path.join(this.#checkout.root, CORE_SERVICE_PATHS.lockDirectory);
    await this.#ensureDirectoryChain(lockRoot);
    const runtimeRoot = this.#runtimeRoot();
    return this.#lock.run(
      path.join(this.#checkout.root, CORE_SERVICE_PATHS.packageManagerLock),
      async () => {
        const existed = Boolean(await lstatOrNull(runtimeRoot));
        if (create) await this.#ensureDirectoryChain(runtimeRoot);
        return operation(runtimeRoot, existed);
      },
      { busyCode: "PACKAGE_SUPPLY_BUSY" },
    );
  }

  async #ensureDirectoryChain(target) {
    const relative = path.relative(this.#checkout.root, target);
    let current = this.#checkout.root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const stat = await ensureDirectory(current, { mode: 0o700 });
      if (!stat.isDirectory() || stat.isSymbolicLink()) invalid(`${relative} небезопасен`);
    }
  }

  #runtimeRoot() {
    return path.join(this.#checkout.root, CORE_SERVICE_PATHS.packageDirectory);
  }

  async #readOrCreateManifest(runtimeRoot) {
    const current = await this.#readManifest(runtimeRoot, { optional: true });
    if (current) return current;
    const manifest = emptyManifest();
    await this.#writeManifest(runtimeRoot, manifest);
    return manifest;
  }

  async #readManifest(runtimeRoot, { optional = false } = {}) {
    const target = path.join(runtimeRoot, "package.json");
    const stat = await lstatOrNull(target);
    if (!stat && optional) return null;
    if (!stat?.isFile() || stat.isSymbolicLink()) invalid("package.json отсутствует или небезопасен");
    try {
      return assertManifest(JSON.parse(await fs.readFile(target, "utf8")));
    } catch (error) {
      if (error.message.startsWith("PACKAGE_SUPPLY_INVALID:")) throw error;
      invalid(`package.json повреждён: ${error.message}`, { cause: error });
    }
  }

  async #assertLockedState(runtimeRoot, manifest) {
    const target = path.join(runtimeRoot, "package-lock.json");
    const stat = await lstatOrNull(target);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      invalid("package-lock.json отсутствует или небезопасен");
    }
    let lockfile;
    try {
      lockfile = JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
      invalid(`package-lock.json повреждён: ${error.message}`, { cause: error });
    }
    if (!lockfile || typeof lockfile !== "object" || Array.isArray(lockfile)) {
      invalid("package-lock.json имеет несовместимый формат");
    }
    const lockedDependencies = lockfile.packages?.[""]?.dependencies ?? lockfile.dependencies ?? {};
    const dependencyEntries = (value) => Object.entries(value).sort(([left], [right]) => (
      left.localeCompare(right)
    ));
    if (
      typeof lockedDependencies !== "object" ||
      Array.isArray(lockedDependencies) ||
      JSON.stringify(dependencyEntries(lockedDependencies)) !==
        JSON.stringify(dependencyEntries(manifest.dependencies))
    ) {
      invalid("package.json и package-lock.json содержат разные dependencies");
    }
  }

  #writeManifest(runtimeRoot, manifest) {
    return this.#writer.write(
      path.join(runtimeRoot, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  async #requirePackageRoot(runtimeRoot, packageName) {
    const target = packagePath(runtimeRoot, packageName);
    const stat = await lstatOrNull(target);
    if (!stat) unavailable(`${packageName}: выполните openspec-orch package sync`);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid(`${packageName}: небезопасный package root`);
    const root = await fs.realpath(target);
    const canonicalRuntime = await fs.realpath(runtimeRoot);
    if (!isContainedPath(canonicalRuntime, root)) invalid(`${packageName}: package root вышел из runtime`);
    return root;
  }

  async #snapshot(runtimeRoot, existed) {
    const read = async (name) => {
      const target = path.join(runtimeRoot, name);
      const stat = await lstatOrNull(target);
      if (!stat) return null;
      if (!stat.isFile() || stat.isSymbolicLink()) invalid(`${name} должен быть обычным файлом`);
      return fs.readFile(target, "utf8");
    };
    return Object.freeze({
      existed,
      manifest: await read("package.json"),
      lockfile: await read("package-lock.json"),
    });
  }

  async #restore(runtimeRoot, snapshot) {
    if (!snapshot.existed) {
      await fs.rm(runtimeRoot, { force: true, recursive: true });
      return;
    }
    const restore = async (name, contents) => {
      const target = path.join(runtimeRoot, name);
      if (contents === null) await fs.rm(target, { force: true });
      else await this.#writer.write(target, contents, { mode: 0o600 });
    };
    await restore("package.json", snapshot.manifest);
    await restore("package-lock.json", snapshot.lockfile);
    if (snapshot.lockfile) await this.#installer.sync({ runtimeRoot });
    else await fs.rm(path.join(runtimeRoot, "node_modules"), { force: true, recursive: true });
  }

  async #rollback(runtimeRoot, snapshot, error) {
    try {
      await this.#restore(runtimeRoot, snapshot);
    } catch (cause) {
      throw new AggregateError(
        [error, cause],
        `PACKAGE_SUPPLY_ROLLBACK_FAILED: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export class PackageSupplyService {
  #dependencies;

  constructor(dependencies = {}) {
    this.#dependencies = Object.freeze({ ...dependencies });
    Object.freeze(this);
  }

  forStore(storeCheckout) {
    return new StorePackageSupply(storeCheckout, this.#dependencies);
  }
}

export const packageSupplies = Object.freeze(new PackageSupplyService());
