/** @fileoverview Проверки атомарных и namespaced persistence APIs нового Core. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AtomicWriter,
  createRepository,
  createRepositoryCheckout,
  FailClosedLock,
  PluginStorage,
  PluginStorageService,
  StoreTarget,
} from "@openspec-orch/core";

/** Создаёт изолированный Store checkout fixture. */
async function storeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createRepository({
    id: "specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
    plugins: ["demo"],
  });
  return { root, checkout: createRepositoryCheckout(repository, root) };
}

test("AtomicWriter replaces a regular file without leaving temporary files", async (t) => {
  const { root } = await storeFixture(t);
  const target = path.join(root, "state.json");
  await fs.writeFile(target, "before", "utf8");

  await new AtomicWriter().write(target, "after", { mode: 0o600 });

  assert.equal(await fs.readFile(target, "utf8"), "after");
  assert.deepEqual(await fs.readdir(root), ["state.json"]);
  await fs.symlink(path.join(root, "outside.json"), path.join(root, "linked.json"));
  await assert.rejects(
    new AtomicWriter().write(path.join(root, "linked.json"), "blocked"),
    /ATOMIC_WRITE_UNSAFE/,
  );
});

test("FailClosedLock rejects concurrent mutation and releases after failure", async (t) => {
  const { root } = await storeFixture(t);
  const lockPath = path.join(root, "state.lock");
  const lock = new FailClosedLock();
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = lock.run(lockPath, async () => {
    entered();
    await waiting;
    throw new Error("operation failed");
  });
  await started;

  await assert.rejects(lock.run(lockPath, async () => null), /STATE_BUSY/);
  release();
  await assert.rejects(first, /operation failed/);
  assert.equal(await fs.lstat(lockPath).catch((error) => error.code), "ENOENT");
});

test("PluginStorage writes a strict envelope and exposes only scoped data", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const storage = new PluginStorageService().forPlugin(checkout, "demo");

  assert.equal(storage instanceof PluginStorage, true);
  assert.equal(storage.pluginId, "demo");
  assert.equal("root" in storage, false);
  assert.equal(await storage.read(), null);
  const stored = await storage.write({ enabled: true, nested: { count: 1 } });

  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.nested), true);
  assert.deepEqual(await storage.read(), stored);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, ".openspec-orch/plugins/demo/state.json"), "utf8")),
    {
      storage_version: 1,
      plugin_id: "demo",
      data: { enabled: true, nested: { count: 1 } },
    },
  );
});

test("PluginStorage isolates namespaces and serializes update under one lock", async (t) => {
  const { checkout } = await storeFixture(t);
  const service = new PluginStorageService();
  const demo = service.forPlugin(checkout, "demo");
  const audit = service.forPlugin(checkout, "dependency-audit");
  await demo.write({ count: 1 });
  await audit.write({ count: 10 });

  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = demo.update(async (current) => {
    entered();
    await waiting;
    return { count: current.count + 1 };
  });
  await started;

  await assert.rejects(demo.update(async () => ({ count: 100 })), /PLUGIN_STORAGE_BUSY/);
  release();
  assert.deepEqual(await first, { count: 2 });
  assert.deepEqual(await demo.read(), { count: 2 });
  assert.deepEqual(await audit.read(), { count: 10 });
});

test("PluginStorage fails closed for invalid data, envelope and symlink paths", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const storage = new PluginStorageService().forPlugin(checkout, "demo");
  await storage.write({ valid: true });
  const target = path.join(root, ".openspec-orch/plugins/demo/state.json");

  await assert.rejects(storage.write({ value: 1n }), /PLUGIN_STORAGE_INVALID/);
  assert.deepEqual(await storage.read(), { valid: true });
  await fs.writeFile(target, "{broken", "utf8");
  await assert.rejects(storage.read(), /PLUGIN_STORAGE_CORRUPTED/);
  await assert.rejects(storage.update(async () => ({ replaced: true })), /PLUGIN_STORAGE_CORRUPTED/);
  assert.equal(await fs.readFile(target, "utf8"), "{broken");

  await fs.writeFile(target, JSON.stringify({
    storage_version: 2,
    plugin_id: "demo",
    data: {},
  }), "utf8");
  await assert.rejects(storage.read(), /PLUGIN_STORAGE_CORRUPTED/);
  await fs.writeFile(target, JSON.stringify({
    storage_version: 1,
    plugin_id: "another-plugin",
    data: {},
  }), "utf8");
  await assert.rejects(storage.read(), /PLUGIN_STORAGE_CORRUPTED/);

  await fs.rm(path.join(root, ".openspec-orch/plugins/demo"), { recursive: true });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-storage-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "state.json"), "{}", "utf8");
  await fs.symlink(outside, path.join(root, ".openspec-orch/plugins/demo"), "dir");
  await assert.rejects(storage.read(), /PLUGIN_STORAGE_CORRUPTED/);
});

test("PluginStorage accepts only Store checkout and canonical Plugin ID", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const codeRepository = createRepository({
    id: "frontend",
    role: "code",
    remote: "https://example.test/frontend.git",
    defaultBranch: "main",
    plugins: [],
  });
  const codeCheckout = createRepositoryCheckout(codeRepository, root);

  assert.throws(() => new PluginStorageService().forPlugin(codeCheckout, "demo"), /Store/);
  assert.throws(() => new PluginStorageService().forPlugin(new StoreTarget("specs", root), "demo"), /Store/);
  assert.throws(() => new PluginStorageService().forPlugin(checkout, "../demo"), /plugin-id/);
});
