/** @fileoverview Общий npm-backed package store для Plugins и Extensions. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriter } from "../atomic-writer.js";
import { CORE_SERVICE_PATHS } from "../constants.js";
import { ensureSafeDirectoryChain, lstatOrNull } from "../fs.js";
import { locks } from "../lock.js";
import { npmPackageInstaller } from "../npm-package-installer.js";
import {
  assertPackageLock,
  assertPackageManifest,
  assertPackageRequest,
  emptyPackageManifest,
  hasMutablePackageProvenance,
  lockedPackage,
  PACKAGE_KINDS,
  packageLockFingerprint,
  packageProvenance,
} from "./package-runtime-contract.js";
import {
  inspectInstalledPackage,
  inspectRuntimeRoot,
  invalidateRuntime,
  matchesRuntimeLock,
  requireInstalledPackageRoot,
  RUNTIME_LOCK_MARKER,
  unavailable,
} from "./package-runtime-state.js";

/** Завершает operation стабильной ошибкой package supply. */
function invalid(message, options) {
  throw new Error(`PACKAGE_SUPPLY_INVALID: ${message}`, options);
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
    assertPackageRequest(kind, id);
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
            await requireInstalledPackageRoot(runtimeRoot, packageName),
            Object.freeze({
              runtimeRevision: packageLockFingerprint(await this.#assertLockedState(runtimeRoot, installed)),
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
    assertPackageRequest(kind, id);
    const runtimeRoot = this.#runtimeRoot();
    const runtimeStat = await inspectRuntimeRoot(this.#checkout.root);
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
    if (!await matchesRuntimeLock(runtimeRoot, lockfile)) {
      unavailable(
        `${packageName}: runtime не подтверждён для текущего полного package-lock; ` +
          "выполните openspec-orch package sync",
      );
    }
    return Object.freeze({
      packageName,
      packageRoot: runtime.packageRoot,
      runtimeRoot,
      runtimeRevision: packageLockFingerprint(lockfile),
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
      if (unavailablePackages.length === 0 && await matchesRuntimeLock(runtimeRoot, lockfile)) {
        return false;
      }
      await this.#synchronize(runtimeRoot, manifest, lockfile);
      return true;
    }, { create: false });
  }

  /** Inspects manifest, lock provenance and materialized packages without changing the Store. */
  async inspect() {
    const runtimeRoot = this.#runtimeRoot();
    const runtimeStat = await inspectRuntimeRoot(this.#checkout.root);
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
    const matchesLock = await matchesRuntimeLock(runtimeRoot, lockfile);
    const packages = [];
    for (const kind of PACKAGE_KINDS) {
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
          mutable: hasMutablePackageProvenance(provenance),
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
    assertPackageRequest(kind, id);
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
        const stillUsed = PACKAGE_KINDS.some((currentKind) => (
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
        const existed = Boolean(await inspectRuntimeRoot(this.#checkout.root));
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

  #runtimeRoot() {
    return path.join(this.#checkout.root, CORE_SERVICE_PATHS.packageDirectory);
  }

  async #readOrCreateManifest(runtimeRoot) {
    const current = await this.#readManifest(runtimeRoot, { optional: true });
    if (current) return current;
    const manifest = emptyPackageManifest();
    await this.#writeManifest(runtimeRoot, manifest);
    return manifest;
  }

  async #readManifest(runtimeRoot, { optional = false } = {}) {
    const target = path.join(runtimeRoot, "package.json");
    const stat = await lstatOrNull(target);
    if (!stat && optional) return null;
    if (!stat?.isFile() || stat.isSymbolicLink()) invalid("package.json отсутствует или небезопасен");
    try {
      return assertPackageManifest(JSON.parse(await fs.readFile(target, "utf8")));
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
    return assertPackageLock(lockfile, manifest);
  }

  async #inspectLockedRuntime(runtimeRoot, lockfile, packageName) {
    const locked = lockedPackage(lockfile, packageName);
    const runtime = await inspectInstalledPackage(runtimeRoot, packageName, locked.version);
    return Object.freeze({ locked, runtime });
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
      `${packageLockFingerprint(lockfile)}\n`,
      { mode: 0o600 },
    );
  }

  /** Keeps every npm mutation stale until the resulting full lock is materialized and checked. */
  async #mutateRuntime(runtimeRoot, operation) {
    await invalidateRuntime(runtimeRoot);
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
