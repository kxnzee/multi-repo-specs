/** @fileoverview Общий npm-backed package store для Plugins и Extensions. */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import * as z from "zod";

import { atomicWriter } from "./atomic-writer.js";
import { CORE_PATTERNS, CORE_SERVICE_PATHS } from "./constants.js";
import { ensureSafeDirectoryChain, lstatOrNull } from "./fs.js";
import { locks } from "./lock.js";
import { npmPackageInstaller } from "./npm-package-installer.js";
import { isContainedPath } from "./path.js";

const KINDS = new Set(["extensions", "plugins"]);
const RUNTIME_LOCK_MARKER = ".openspec-orch-lock.sha256";
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const PACKAGE_MAP_SCHEMA = z.record(
  z.string().regex(CORE_PATTERNS.id),
  z.string().regex(PACKAGE_NAME),
);
const PACKAGE_MANIFEST_SCHEMA = z.object({
  private: z.literal(true),
  dependencies: z.record(z.string().regex(PACKAGE_NAME), z.string().min(1)).default({}),
  openspecOrchestrator: z.object({
    extensions: PACKAGE_MAP_SCHEMA,
    plugins: PACKAGE_MAP_SCHEMA,
  }).passthrough(),
}).passthrough();
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

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
  const parsed = PACKAGE_MANIFEST_SCHEMA.safeParse(manifest);
  if (!parsed.success) {
    invalid("package.json имеет несовместимый формат");
  }
  const checked = parsed.data;
  for (const kind of KINDS) {
    for (const [id, packageName] of Object.entries(checked.openspecOrchestrator[kind])) {
      if (!Object.hasOwn(checked.dependencies, packageName)) {
        invalid(`package.json mapping ${kind}/${id} не входит в dependencies`);
      }
    }
  }
  return checked;
}

/** Возвращает стандартный node_modules path package. */
function packagePath(runtimeRoot, packageName) {
  if (!PACKAGE_NAME.test(packageName)) invalid(`некорректное npm package name '${packageName}'`);
  return path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
}

/** Classifies the resolved dependency declaration without trying to replace npm resolution. */
function packageProvenance(requested, locked = {}) {
  if (requested.startsWith("file:")) return "local";
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/u.test(requested)) {
    return /#[0-9a-f]{40}$/iu.test(requested) || /[0-9a-f]{40}$/iu.test(locked.resolved ?? "")
      ? "git-commit"
      : "git-mutable";
  }
  if (/^https?:/u.test(requested)) return locked.integrity ? "tarball-integrity" : "tarball";
  return EXACT_VERSION.test(requested) ? "registry-exact" : "registry-mutable";
}

/** Returns whether one provenance class can resolve differently without changing Store files. */
function mutableProvenance(value) {
  return ["git-mutable", "local", "registry-mutable", "tarball"].includes(value);
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
        const value = await this.#mutateRuntime(runtimeRoot, async () => {
          // npm considers an unchanged file source/version up to date, even if its bytes changed.
          // Remove the old resolution inside this transaction before resolving the explicit update.
          if (previousPackage) {
            await this.#installer.remove({ packageName: previousPackage, runtimeRoot });
          }
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
          const result = await validate(
            await this.#requirePackageRoot(runtimeRoot, packageName),
            Object.freeze({
              runtimeRevision: this.#lockFingerprint(await this.#assertLockedState(runtimeRoot, installed)),
            }),
          );
          installed.openspecOrchestrator[kind][id] = packageName;
          await this.#writeManifest(runtimeRoot, installed);
          const lockfile = await this.#assertLockedState(runtimeRoot, installed);
          return { lockfile, manifest: installed, result };
        });
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
    const runtimeStat = await this.#runtimeStat();
    if (!runtimeStat) unavailable(`${kind}/${id}: package runtime отсутствует`);
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
      invalid(`${CORE_SERVICE_PATHS.packageDirectory} должен быть безопасным каталогом`);
    }
    const manifest = await this.#readManifest(runtimeRoot, { optional: true });
    const lockfile = manifest ? await this.#assertLockedState(runtimeRoot, manifest) : null;
    const packageName = manifest?.openspecOrchestrator[kind][id];
    if (!packageName) unavailable(`${kind}/${id}: package не зарегистрирован`);
    if (!Object.hasOwn(manifest.dependencies, packageName)) {
      invalid(`${kind}/${id}: mapping не входит в dependencies`);
    }
    const { locked, runtime } = await this.#inspectLockedRuntime(
      runtimeRoot,
      lockfile,
      packageName,
    );
    if (runtime.state !== "ready") {
      unavailable(
        `${packageName}: runtime ${runtime.version ?? "отсутствует"} не соответствует ` +
          `package-lock ${locked.version ?? "без версии"}; выполните openspec-orch package sync`,
      );
    }
    if (!await this.#matchesRuntimeLock(runtimeRoot, lockfile)) {
      unavailable(
        `${packageName}: runtime не подтверждён для текущего полного package-lock; ` +
          "выполните openspec-orch package sync",
      );
    }
    return Object.freeze({
      packageName,
      packageRoot: runtime.packageRoot,
      runtimeRoot,
      runtimeRevision: this.#lockFingerprint(lockfile),
      version: locked.version,
    });
  }

  /** Restores a missing or stale node_modules tree from the committed npm lock. */
  async ensure() {
    return this.#withLock(async (runtimeRoot, existed) => {
      if (!existed) return false;
      const manifest = await this.#readManifest(runtimeRoot);
      if (Object.keys(manifest.dependencies).length === 0) return false;
      const lockfile = await this.#assertLockedState(runtimeRoot, manifest);
      const unavailablePackages = [];
      for (const packageName of Object.keys(manifest.dependencies)) {
        const { runtime } = await this.#inspectLockedRuntime(runtimeRoot, lockfile, packageName);
        if (runtime.state !== "ready") unavailablePackages.push(packageName);
      }
      if (unavailablePackages.length === 0 && await this.#matchesRuntimeLock(runtimeRoot, lockfile)) {
        return false;
      }
      await this.#synchronize(runtimeRoot, manifest, lockfile);
      return true;
    }, { create: false });
  }

  /** Inspects manifest, lock provenance and materialized packages without changing the Store. */
  async inspect() {
    const runtimeRoot = this.#runtimeRoot();
    const runtimeStat = await this.#runtimeStat();
    if (!runtimeStat) {
      return Object.freeze({
        state: "absent",
        runtimeRoot,
        packages: Object.freeze([]),
        mutable: 0,
        available: 0,
      });
    }
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()) {
      invalid(`${CORE_SERVICE_PATHS.packageDirectory} должен быть безопасным каталогом`);
    }
    const manifest = await this.#readManifest(runtimeRoot);
    const lockfile = await this.#assertLockedState(runtimeRoot, manifest);
    const matchesLock = await this.#matchesRuntimeLock(runtimeRoot, lockfile);
    const packages = [];
    for (const kind of [...KINDS].sort()) {
      for (const [id, packageName] of Object.entries(manifest.openspecOrchestrator[kind])) {
        const requested = manifest.dependencies[packageName];
        const { locked, runtime } = await this.#inspectLockedRuntime(
          runtimeRoot,
          lockfile,
          packageName,
        );
        const provenance = packageProvenance(requested, locked);
        packages.push(Object.freeze({
          id,
          kind,
          packageName,
          requested,
          version: typeof locked.version === "string" ? locked.version : null,
          resolved: typeof locked.resolved === "string" ? locked.resolved : null,
          integrity: typeof locked.integrity === "string" ? locked.integrity : null,
          provenance,
          mutable: mutableProvenance(provenance),
          available: runtime.state !== "missing",
          state: runtime.state === "ready" && !matchesLock ? "stale" : runtime.state,
          runtimeVersion: runtime.version,
        }));
      }
    }
    const available = packages.filter((entry) => entry.available).length;
    const state = packages.some((entry) => entry.state === "missing")
      ? "missing"
      : packages.some((entry) => entry.state === "stale") ? "stale" : "ready";
    return Object.freeze({
      state,
      runtimeRoot,
      packages: Object.freeze(packages),
      mutable: packages.filter((entry) => entry.mutable).length,
      available,
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
        if (!stillUsed) {
          await this.#mutateRuntime(runtimeRoot, async () => {
            await this.#installer.remove({ packageName, runtimeRoot });
            const updated = await this.#readManifest(runtimeRoot);
            updated.openspecOrchestrator = manifest.openspecOrchestrator;
            await this.#writeManifest(runtimeRoot, updated);
            const lockfile = await this.#assertLockedState(runtimeRoot, updated);
            return { lockfile, manifest: updated };
          });
        } else {
          const updated = await this.#readManifest(runtimeRoot);
          updated.openspecOrchestrator = manifest.openspecOrchestrator;
          await this.#writeManifest(runtimeRoot, updated);
        }
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
      const lockfile = await this.#assertLockedState(runtimeRoot, manifest);
      await this.#synchronize(runtimeRoot, manifest, lockfile);
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
        const existed = Boolean(await this.#runtimeStat());
        if (create) await this.#ensureDirectoryChain(runtimeRoot);
        return operation(runtimeRoot, existed);
      },
      { busyCode: "PACKAGE_SUPPLY_BUSY" },
    );
  }

  async #ensureDirectoryChain(target) {
    const relative = path.relative(this.#checkout.root, target);
    try {
      await ensureSafeDirectoryChain(this.#checkout.root, relative, { mode: 0o700 });
    } catch (error) {
      invalid(`${relative} небезопасен`, { cause: error });
    }
  }

  /** Checks the complete Store-owned directory chain before reads or npm mutations. */
  async #runtimeStat() {
    let current = this.#checkout.root;
    let stat;
    for (const segment of CORE_SERVICE_PATHS.packageDirectory.split("/")) {
      current = path.join(current, segment);
      stat = await lstatOrNull(current);
      if (!stat) return null;
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        invalid(`${CORE_SERVICE_PATHS.packageDirectory} содержит небезопасный каталог`);
      }
    }
    return stat;
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
    if (
      !lockfile ||
      typeof lockfile !== "object" ||
      Array.isArray(lockfile) ||
      lockfile.lockfileVersion !== 3 ||
      !lockfile.packages ||
      typeof lockfile.packages !== "object" ||
      Array.isArray(lockfile.packages) ||
      !lockfile.packages[""] ||
      typeof lockfile.packages[""] !== "object" ||
      Array.isArray(lockfile.packages[""])
    ) {
      invalid("package-lock.json имеет несовместимый формат");
    }
    const lockedDependencies = lockfile.packages[""].dependencies ?? {};
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
    return lockfile;
  }

  #lockedPackage(lockfile, packageName) {
    const locked = lockfile?.packages?.[`node_modules/${packageName}`] ?? {};
    return locked && typeof locked === "object" && !Array.isArray(locked) ? locked : {};
  }

  async #inspectLockedRuntime(runtimeRoot, lockfile, packageName) {
    const locked = this.#lockedPackage(lockfile, packageName);
    const runtime = await this.#inspectPackageRuntime(runtimeRoot, packageName, locked.version);
    return Object.freeze({ locked, runtime });
  }

  #lockFingerprint(lockfile) {
    return createHash("sha256").update(JSON.stringify(lockfile)).digest("hex");
  }

  async #runtimeMarker(runtimeRoot) {
    const modules = path.join(runtimeRoot, "node_modules");
    const stat = await lstatOrNull(modules);
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid("node_modules небезопасен");
    return path.join(modules, RUNTIME_LOCK_MARKER);
  }

  async #matchesRuntimeLock(runtimeRoot, lockfile) {
    const marker = await this.#runtimeMarker(runtimeRoot);
    if (!marker) return false;
    const stat = await lstatOrNull(marker);
    if (!stat) return false;
    if (!stat.isFile() || stat.isSymbolicLink()) invalid("runtime lock marker небезопасен");
    return (await fs.readFile(marker, "utf8")).trim() === this.#lockFingerprint(lockfile);
  }

  async #invalidateRuntime(runtimeRoot) {
    const marker = await this.#runtimeMarker(runtimeRoot);
    if (marker) await fs.rm(marker, { force: true });
  }

  /** Records the full lock only after npm and direct package validation succeed. */
  async #markRuntime(runtimeRoot, manifest, lockfile) {
    for (const packageName of Object.keys(manifest.dependencies)) {
      const { locked, runtime } = await this.#inspectLockedRuntime(
        runtimeRoot,
        lockfile,
        packageName,
      );
      if (runtime.state !== "ready") {
        unavailable(`${packageName}: npm не восстановил версию ${locked.version ?? "из lockfile"}`);
      }
    }
    await this.#ensureDirectoryChain(path.join(runtimeRoot, "node_modules"));
    await this.#writer.write(
      path.join(runtimeRoot, "node_modules", RUNTIME_LOCK_MARKER),
      `${this.#lockFingerprint(lockfile)}\n`,
      { mode: 0o600 },
    );
  }

  /** Keeps every npm mutation stale until the resulting full lock is materialized and checked. */
  async #mutateRuntime(runtimeRoot, operation) {
    await this.#invalidateRuntime(runtimeRoot);
    const outcome = await operation();
    if (outcome === null) return undefined;
    await this.#markRuntime(runtimeRoot, outcome.manifest, outcome.lockfile);
    return outcome.result;
  }

  async #synchronize(runtimeRoot, manifest, lockfile) {
    await this.#mutateRuntime(runtimeRoot, async () => {
      await this.#installer.sync({ runtimeRoot });
      return { lockfile, manifest };
    });
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

  async #inspectPackageRuntime(runtimeRoot, packageName, lockedVersion) {
    let packageRoot;
    try {
      packageRoot = await this.#requirePackageRoot(runtimeRoot, packageName);
    } catch (error) {
      if (error?.code !== "PACKAGE_RUNTIME_UNAVAILABLE") throw error;
      return Object.freeze({ packageRoot: null, state: "missing", version: null });
    }
    const manifestPath = path.join(packageRoot, "package.json");
    const stat = await lstatOrNull(manifestPath);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      invalid(`${packageName}: package.json отсутствует или небезопасен`);
    }
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      invalid(`${packageName}: package.json повреждён: ${error.message}`, { cause: error });
    }
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      manifest.name !== packageName ||
      typeof manifest.version !== "string" ||
      !manifest.version
    ) {
      invalid(`${packageName}: package.json не соответствует установленному package`);
    }
    return Object.freeze({
      packageRoot,
      state: typeof lockedVersion === "string" && manifest.version === lockedVersion
        ? "ready"
        : "stale",
      version: manifest.version,
    });
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
    await this.#mutateRuntime(runtimeRoot, async () => {
      const restore = async (name, contents) => {
        const target = path.join(runtimeRoot, name);
        if (contents === null) await fs.rm(target, { force: true });
        else await this.#writer.write(target, contents, { mode: 0o600 });
      };
      await restore("package.json", snapshot.manifest);
      await restore("package-lock.json", snapshot.lockfile);
      if (!snapshot.lockfile) {
        await fs.rm(path.join(runtimeRoot, "node_modules"), { force: true, recursive: true });
        return null;
      }
      const manifest = await this.#readManifest(runtimeRoot);
      const lockfile = await this.#assertLockedState(runtimeRoot, manifest);
      await this.#installer.sync({ runtimeRoot });
      return { lockfile, manifest };
    });
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
