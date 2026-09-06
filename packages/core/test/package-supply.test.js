/** @fileoverview Контракт единого npm package supply Store. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  const writeLock = (runtimeRoot, manifest) => fs.writeFile(
    path.join(runtimeRoot, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: {}, dependencies: manifest.dependencies })}\n`,
  );
  const materialize = async (runtimeRoot) => {
    const packageRoot = path.join(runtimeRoot, "node_modules", "@test", "sample-plugin");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: PACKAGE_NAME,
      version: "1.0.0",
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
      await materialize(runtimeRoot);
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
    dependencies: {},
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
    dependencies: {},
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
    dependencies: { "a-package": "2.0.0", "z-package": "1.0.0" },
  }));

  assert.equal(await supply.sync(), true);
  assert.deepEqual(calls, [["sync"]]);
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
  assert.deepEqual(ready.packages.map(({ id, kind, provenance, available }) => ({
    id, kind, provenance, available,
  })), [{ id: "sample", kind: "plugins", provenance: "local", available: true }]);

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

test("StorePackageSupply reports an absent external package project without creating it", async (t) => {
  const { root, supply } = await fixture(t);

  const report = await supply.inspect();

  assert.equal(report.state, "absent");
  assert.deepEqual(report.packages, []);
  assert.equal(await supply.ensure(), false);
  await assert.rejects(fs.lstat(path.join(root, ".openspec-orch/packages")), { code: "ENOENT" });
});
