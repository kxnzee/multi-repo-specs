/** @fileoverview Проверки переносимого Plugin installation lock. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRepository,
  createRepositoryCheckout,
  PluginInstallationRecord,
  PluginLock,
  PluginLockService,
  PluginLockStore,
} from "@openspec-orch/core";

/** Создаёт изолированный Store checkout. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-lock-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createRepository({
    id: "specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
    plugins: [],
  });
  return { root, checkout: createRepositoryCheckout(repository, root) };
}

/** Создаёт валидный portable record без filesystem source. */
function recordFixture(pluginId, packageName, version = "1.0.0") {
  const packagePath = `node_modules/${packageName}`;
  return PluginInstallationRecord.parse({
    record_version: 1,
    plugin_id: pluginId,
    source: { kind: "npm", spec: `${packageName}@${version}` },
    package: { name: packageName, version, plugin: "./index.js" },
    dependencies: [{
      path: packagePath,
      name: packageName,
      version,
      resolved: `https://registry.example.test/${packageName}/-/${pluginId}.tgz`,
      integrity: "sha512-dGVzdA==",
    }],
  });
}

test("PluginInstallationRecord rejects non-portable or inconsistent lock data", () => {
  const valid = recordFixture("alpha", "plugin-alpha").toJSON();
  assert.equal(Object.isFrozen(PluginInstallationRecord.parse(valid).dependencies), true);

  assert.throws(
    () => PluginInstallationRecord.parse({
      ...valid,
      source: { kind: "npm", spec: "plugin-alpha@latest" },
    }),
    /source spec некорректен/,
  );
  assert.throws(
    () => PluginInstallationRecord.parse({
      ...valid,
      dependencies: [{
        ...valid.dependencies[0],
        path: "../node_modules/plugin-alpha",
      }],
    }),
    /небезопасный dependency path/,
  );
  assert.throws(
    () => PluginInstallationRecord.parse({
      ...valid,
      dependencies: [{
        ...valid.dependencies[0],
        resolved: "https://token@registry.example.test/plugin-alpha.tgz",
      }],
    }),
    /credentials/,
  );
});

test("PluginLockStore atomically persists sorted portable installation records", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const store = new PluginLockService().forStore(checkout);
  const alpha = recordFixture("alpha", "@test/plugin-alpha");
  const beta = recordFixture("beta", "plugin-beta", "2.0.0");

  assert.equal(store instanceof PluginLockStore, true);
  assert.deepEqual((await store.read()).records, []);
  const written = await store.write(new PluginLock([beta, alpha]));

  assert.deepEqual(written.records.map((record) => record.pluginId), ["alpha", "beta"]);
  const source = await fs.readFile(path.join(root, "openspec-orch.plugins-lock.json"), "utf8");
  assert.equal(source.includes(root), false);
  assert.deepEqual(JSON.parse(source).plugins.map((record) => record.plugin_id), ["alpha", "beta"]);
  const restored = await store.read();
  assert.equal(restored.get("alpha").equals(alpha), true);
  assert.equal(restored.get("missing"), null);
});

test("PluginLock update replaces and removes only the selected Plugin record", async (t) => {
  const { checkout } = await storeFixture(t);
  const store = new PluginLockStore(checkout);
  const alpha = recordFixture("alpha", "plugin-alpha");
  const updated = recordFixture("alpha", "plugin-alpha", "2.0.0");
  const beta = recordFixture("beta", "plugin-beta");
  await store.write(new PluginLock([alpha, beta]));

  await store.update((current) => current.with(updated));
  assert.equal((await store.read()).get("alpha").version, "2.0.0");
  await store.update((current) => current.without("alpha"));
  assert.deepEqual((await store.read()).records.map((record) => record.pluginId), ["beta"]);
});

test("PluginLockStore fails closed for corrupted or symlinked lock", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const store = new PluginLockStore(checkout);
  const target = path.join(root, "openspec-orch.plugins-lock.json");
  await fs.writeFile(target, JSON.stringify({ lock_version: 1, plugins: [], extra: true }));
  await assert.rejects(store.read(), /PLUGIN_LOCK_INVALID/);

  await fs.rm(target);
  const outside = path.join(root, "outside.json");
  await fs.writeFile(outside, JSON.stringify({ lock_version: 1, plugins: [] }));
  await fs.symlink(outside, target);
  await assert.rejects(store.read(), /обычным файлом/);
  await assert.rejects(
    store.write(new PluginLock()),
    /обычным файлом/,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(outside)), { lock_version: 1, plugins: [] });
});
