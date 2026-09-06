/** @fileoverview Контракт единого npm package supply Store. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { execa } from "execa";

import {
  createRepository,
  createRepositoryCheckout,
  PackageSupplyService,
} from "@openspec-orch/core";

const PACKAGE_NAME = "@test/sample-plugin";

/** Создаёт Store checkout и npm emulator, сохраняющий реальный manifest/lock. */
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-supply-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const writeLock = (runtimeRoot, manifest, version = "1.0.0") => fs.writeFile(
    path.join(runtimeRoot, "package-lock.json"),
    `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: manifest.dependencies },
        ...(Object.hasOwn(manifest.dependencies, PACKAGE_NAME) ? {
          [`node_modules/${PACKAGE_NAME}`]: { name: PACKAGE_NAME, version },
        } : {}),
      },
    })}\n`,
  );
  const materialize = async (runtimeRoot, version = "1.0.0", name = PACKAGE_NAME) => {
    const packageRoot = path.join(runtimeRoot, "node_modules", ...name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name,
      version,
    }));
  };
  const installer = {
    async install({ runtimeRoot, source }) {
      calls.push(["install", source]);
      const manifestPath = path.join(runtimeRoot, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.dependencies[PACKAGE_NAME] = `file:${source}`;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await writeLock(runtimeRoot, manifest);
      await materialize(runtimeRoot);
    },
    async remove({ packageName, runtimeRoot }) {
      calls.push(["remove", packageName]);
      const manifestPath = path.join(runtimeRoot, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      delete manifest.dependencies[packageName];
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await writeLock(runtimeRoot, manifest);
      await fs.rm(path.join(runtimeRoot, "node_modules"), { recursive: true, force: true });
    },
    async sync({ runtimeRoot }) {
      calls.push(["sync"]);
      const lockfile = JSON.parse(await fs.readFile(path.join(runtimeRoot, "package-lock.json")));
      for (const [entry, locked] of Object.entries(lockfile.packages)) {
        if (entry) await materialize(runtimeRoot, locked.version, locked.name);
      }
    },
  };
  const checkout = createRepositoryCheckout(createRepository({
    id: "specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
    plugins: [],
  }), root);
  return {
    calls,
    installer,
    root,
    supply: new PackageSupplyService({ installer }).forStore(checkout),
  };
}

test("StorePackageSupply lets npm own versions and keeps only ID mappings", async (t) => {
  const { calls, root, supply } = await fixture(t);
  const source = "/packages/sample-plugin";
  const value = await supply.install({
    id: "sample",
    kind: "plugins",
    source,
    validate: async (packageRoot) => path.basename(packageRoot),
  });
  const resolved = await supply.resolve("plugins", "sample");
  const manifest = JSON.parse(await fs.readFile(
    path.join(root, ".openspec-orch/packages/package.json"),
    "utf8",
  ));

  assert.equal(value, "sample-plugin");
  assert.equal(resolved.packageName, PACKAGE_NAME);
  assert.equal(manifest.dependencies[PACKAGE_NAME], `file:${source}`);
  assert.deepEqual(manifest.openspecOrchestrator.plugins, { sample: PACKAGE_NAME });
  assert.equal(await supply.remove("plugins", "sample"), true);
  assert.deepEqual(calls, [["install", source], ["remove", PACKAGE_NAME]]);
});

test("StorePackageSupply restores package.json and lockfile when publication fails", async (t) => {
  const { calls, root, supply } = await fixture(t);
  await supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin",
    validate: async () => true,
  });
  const packageFile = path.join(root, ".openspec-orch/packages/package.json");
  const before = await fs.readFile(packageFile, "utf8");

  await assert.rejects(supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin-v2",
    validate: async () => true,
    publish: async () => { throw new Error("publish failed"); },
  }), /publish failed/);

  assert.equal(await fs.readFile(packageFile, "utf8"), before);
  assert.equal(calls.at(-1)[0], "sync");
  assert.equal((await supply.inspect()).state, "ready");
  assert.equal(await supply.ensure(), false);
});

test("StorePackageSupply leaves no runtime after a failed first install or absent remove", async (t) => {
  const { root, supply } = await fixture(t);
  const runtimeRoot = path.join(root, ".openspec-orch/packages");

  await assert.rejects(supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin",
    validate: async () => true,
    publish: async () => { throw new Error("publish failed"); },
  }), /publish failed/);
  await assert.rejects(fs.lstat(runtimeRoot), { code: "ENOENT" });

  assert.equal(await supply.remove("plugins", "missing"), false);
  await assert.rejects(fs.lstat(runtimeRoot), { code: "ENOENT" });
});

test("StorePackageSupply rejects inconsistent manifest and lock before npm mutation", async (t) => {
  const { calls, root, supply } = await fixture(t);
  await supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin",
    validate: async () => true,
  });
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  await fs.writeFile(path.join(runtimeRoot, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: { "": { dependencies: {} } },
  }));

  await assert.rejects(supply.sync(), /package\.json и package-lock\.json содержат разные dependencies/);
  await assert.rejects(supply.resolve("plugins", "sample"), /разные dependencies/);
  await assert.rejects(supply.remove("plugins", "sample"), /разные dependencies/);
  assert.deepEqual(calls, [["install", "/packages/sample-plugin"]]);
});

test("StorePackageSupply rejects mappings outside dependencies", async (t) => {
  const { root, supply } = await fixture(t);
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({
    name: "openspec-orchestrator-packages",
    private: true,
    dependencies: {},
    openspecOrchestrator: { extensions: {}, plugins: { sample: PACKAGE_NAME } },
  }));
  await fs.writeFile(path.join(runtimeRoot, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: { "": { dependencies: {} } },
  }));

  await assert.rejects(supply.sync(), /mapping plugins\/sample не входит в dependencies/);
});

test("StorePackageSupply compares dependency maps without relying on key order", async (t) => {
  const { calls, root, supply } = await fixture(t);
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({
    name: "openspec-orchestrator-packages",
    private: true,
    dependencies: { "z-package": "1.0.0", "a-package": "2.0.0" },
    openspecOrchestrator: { extensions: {}, plugins: {} },
  }));
  await fs.writeFile(path.join(runtimeRoot, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "a-package": "2.0.0", "z-package": "1.0.0" } },
      "node_modules/a-package": { name: "a-package", version: "2.0.0" },
      "node_modules/z-package": { name: "z-package", version: "1.0.0" },
    },
  }));

  assert.equal(await supply.sync(), true);
  assert.deepEqual(calls, [["sync"]]);
});

test("StorePackageSupply rejects legacy dependency-only package locks", async (t) => {
  const { root, supply } = await fixture(t);
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, "package.json"), JSON.stringify({
    name: "openspec-orchestrator-packages",
    private: true,
    dependencies: {},
    openspecOrchestrator: { extensions: {}, plugins: {} },
  }));
  await fs.writeFile(path.join(runtimeRoot, "package-lock.json"), JSON.stringify({
    lockfileVersion: 1,
    dependencies: {},
  }));

  await assert.rejects(supply.sync(), /package-lock\.json имеет несовместимый формат/u);
});

test("StorePackageSupply inspects provenance and restores only a missing runtime", async (t) => {
  const { calls, root, supply } = await fixture(t);
  await supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin",
    validate: async () => true,
  });

  const ready = await supply.inspect();
  assert.equal(ready.state, "ready");
  assert.equal(ready.available, 1);
  assert.equal(ready.mutable, 1);
  assert.deepEqual(ready.packages.map(({ id, kind, provenance, state, version, runtimeVersion }) => ({
    id, kind, provenance, state, version, runtimeVersion,
  })), [{
    id: "sample",
    kind: "plugins",
    provenance: "local",
    state: "ready",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
  }]);

  await fs.rm(path.join(root, ".openspec-orch/packages/node_modules"), {
    recursive: true,
    force: true,
  });
  assert.equal((await supply.inspect()).state, "missing");
  assert.equal(await supply.ensure(), true);
  assert.equal(await supply.ensure(), false);
  assert.equal((await supply.inspect()).state, "ready");
  assert.deepEqual(calls.map(([operation]) => operation), ["install", "sync"]);
});

test("StorePackageSupply rejects and repairs a runtime version stale against package-lock", async (t) => {
  const { calls, root, supply } = await fixture(t);
  await supply.install({
    id: "sample",
    kind: "plugins",
    source: "/packages/sample-plugin",
    validate: async () => true,
  });
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  const lockPath = path.join(runtimeRoot, "package-lock.json");
  const lockfile = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lockfile.packages[`node_modules/${PACKAGE_NAME}`].version = "2.0.0";
  await fs.writeFile(lockPath, `${JSON.stringify(lockfile)}\n`);

  const stale = await supply.inspect();
  assert.equal(stale.state, "stale");
  assert.deepEqual(stale.packages.map(({ state, version, runtimeVersion, available }) => ({
    state, version, runtimeVersion, available,
  })), [{ state: "stale", version: "2.0.0", runtimeVersion: "1.0.0", available: true }]);
  await assert.rejects(
    supply.resolve("plugins", "sample"),
    /PACKAGE_RUNTIME_UNAVAILABLE:.*runtime 1\.0\.0.*package-lock 2\.0\.0.*package sync/u,
  );

  assert.equal(await supply.ensure(), true);
  assert.equal((await supply.inspect()).state, "ready");
  assert.equal((await supply.resolve("plugins", "sample")).version, "2.0.0");
  assert.deepEqual(calls.map(([operation]) => operation), ["install", "sync"]);
});

test("StorePackageSupply reports an absent external package project without creating it", async (t) => {
  const { root, supply } = await fixture(t);

  const report = await supply.inspect();

  assert.equal(report.state, "absent");
  assert.deepEqual(report.packages, []);
  assert.equal(await supply.ensure(), false);
  await assert.rejects(fs.lstat(path.join(root, ".openspec-orch/packages")), { code: "ENOENT" });
});

test("StorePackageSupply restores an immutable Git revision even when its version is unchanged", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-supply-git-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await fs.mkdir(source);
  const git = (args) => execa("git", args, { cwd: source });
  await git(["init", "--initial-branch", "main"]);
  await fs.writeFile(path.join(source, "package.json"), JSON.stringify({
    name: "locked-revision", version: "1.0.0",
  }));
  const revisions = [];
  for (const content of ["revision A", "revision B"]) {
    await fs.writeFile(path.join(source, "content.txt"), content);
    await git(["add", "."]);
    await git(["-c", "user.name=Test", "-c", "user.email=test@example.test",
      "-c", "commit.gpgsign=false", "commit", "-m", content]);
    revisions.push((await git(["rev-parse", "HEAD"])).stdout);
  }
  const stores = [];
  for (const [index, revision] of revisions.entries()) {
    const storeRoot = path.join(root, `store-${index}`);
    await fs.mkdir(storeRoot);
    const checkout = createRepositoryCheckout(createRepository({
      id: "specs", role: "store", remote: "https://example.test/specs.git",
      defaultBranch: "main", plugins: [],
    }), storeRoot);
    const supply = new PackageSupplyService().forStore(checkout);
    await supply.install({
      id: "sample", kind: "extensions", source: `git+${pathToFileURL(source).href}#${revision}`,
      validate: async () => true,
    });
    stores.push({ supply, runtimeRoot: path.join(storeRoot, ".openspec-orch/packages") });
  }
  const [previous, next] = stores;
  for (const name of ["package.json", "package-lock.json"]) {
    await fs.copyFile(path.join(next.runtimeRoot, name), path.join(previous.runtimeRoot, name));
  }
  const report = await previous.supply.inspect();
  assert.equal(report.state, "stale");
  assert.equal(report.mutable, 0);
  assert.equal(report.packages[0].provenance, "git-commit");
  assert.equal(report.packages[0].version, report.packages[0].runtimeVersion);
  await assert.rejects(previous.supply.resolve("extensions", "sample"), /PACKAGE_RUNTIME_UNAVAILABLE/);
  assert.equal(await previous.supply.ensure(), true);
  const resolved = await previous.supply.resolve("extensions", "sample");
  assert.equal(await fs.readFile(path.join(resolved.packageRoot, "content.txt"), "utf8"), "revision B");
  assert.equal((await previous.supply.inspect()).state, "ready");
  assert.equal(await previous.supply.ensure(), false);
});

test("StorePackageSupply detects a changed transitive lock entry with an unchanged direct package", async (t) => {
  const { calls, root, supply } = await fixture(t);
  await supply.install({
    id: "sample", kind: "plugins", source: "/packages/sample-plugin", validate: async () => true,
  });
  const runtimeRoot = path.join(root, ".openspec-orch/packages");
  const lockPath = path.join(runtimeRoot, "package-lock.json");
  const lockfile = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lockfile.packages[`node_modules/${PACKAGE_NAME}`].dependencies = { transitive: "^1.0.0" };
  lockfile.packages["node_modules/transitive"] = { name: "transitive", version: "1.0.0" };
  await fs.writeFile(lockPath, JSON.stringify(lockfile));
  await supply.sync();
  lockfile.packages["node_modules/transitive"].version = "1.1.0";
  await fs.writeFile(lockPath, JSON.stringify(lockfile));

  assert.equal((await supply.inspect()).state, "stale");
  await assert.rejects(supply.resolve("plugins", "sample"), /PACKAGE_RUNTIME_UNAVAILABLE/);
  assert.equal(await supply.ensure(), true);
  const transitive = JSON.parse(await fs.readFile(
    path.join(runtimeRoot, "node_modules/transitive/package.json"), "utf8",
  ));
  assert.equal(transitive.version, "1.1.0");
  assert.equal((await supply.inspect()).state, "ready");
  assert.deepEqual(calls.map(([operation]) => operation), ["install", "sync", "sync"]);
});

test("StorePackageSupply invalidates a previous successful installation when sync fails", async (t) => {
  const { installer, supply } = await fixture(t);
  await supply.install({
    id: "sample", kind: "plugins", source: "/packages/sample-plugin", validate: async () => true,
  });
  const synchronize = installer.sync;
  installer.sync = async () => { throw new Error("interrupted npm ci"); };

  await assert.rejects(supply.sync(), /interrupted npm ci/);
  assert.equal((await supply.inspect()).state, "stale");
  await assert.rejects(supply.resolve("plugins", "sample"), /PACKAGE_RUNTIME_UNAVAILABLE/);
  installer.sync = synchronize;
  assert.equal(await supply.ensure(), true);
  assert.equal((await supply.inspect()).state, "ready");
});

test("StorePackageSupply refuses to mark a successful npm call with incomplete materialization ready", async (t) => {
  const { installer, root, supply } = await fixture(t);
  await supply.install({
    id: "sample", kind: "plugins", source: "/packages/sample-plugin", validate: async () => true,
  });
  const synchronize = installer.sync;
  installer.sync = async () => fs.rm(path.join(root, ".openspec-orch/packages/node_modules"), {
    recursive: true, force: true,
  });

  await assert.rejects(supply.sync(), /PACKAGE_RUNTIME_UNAVAILABLE/);
  assert.equal((await supply.inspect()).state, "missing");
  installer.sync = synchronize;
  assert.equal(await supply.ensure(), true);
  assert.equal((await supply.inspect()).state, "ready");
});
