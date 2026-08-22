/** @fileoverview Контракт Store-local development Plugin sources. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createProject,
  createRepositoryCheckout,
  LocalPluginOverrides,
  LocalPluginOverrideService,
  LocalPluginOverrideStore,
  PluginSource,
} from "@openspec-orch/core";

/** Создаёт Store checkout и локальный Plugin package directory. */
async function overrideFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-local-plugin-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pluginRoot = path.join(root, "plugin-source");
  await fs.mkdir(pluginRoot);
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [],
    repositories: [{
      id: "specs",
      role: "store",
      remote: "https://example.test/specs.git",
      defaultBranch: "main",
      plugins: [],
    }],
  });
  const checkout = createRepositoryCheckout(project.storeRepository, root);
  return { checkout, pluginRoot, root };
}

test("LocalPluginOverrides is immutable and serializes entries in Plugin ID order", () => {
  const overrides = new LocalPluginOverrides([
    ["zeta", "/tmp/zeta"],
    ["alpha", "/tmp/alpha"],
  ]);

  assert.equal(overrides.get("alpha"), "/tmp/alpha");
  assert.equal(overrides.has("missing"), false);
  assert.deepEqual(Object.keys(overrides.toJSON().plugins), ["alpha", "zeta"]);
  assert.equal(overrides.without("alpha").has("alpha"), false);
  assert.equal(Object.isFrozen(overrides.entries), true);
  assert.throws(() => overrides.without("../sample"), /некорректный plugin-id/);
  assert.throws(
    () => LocalPluginOverrides.parse({ version: 1, plugins: { sample: "relative" } }),
    /должен быть абсолютным/,
  );
});

test("LocalPluginOverrideStore persists and resolves a machine-local source", async (t) => {
  const { checkout, pluginRoot, root } = await overrideFixture(t);
  const store = new LocalPluginOverrideService().forStore(checkout);
  const source = PluginSource.parse(pluginRoot, { cwd: root });

  const written = await store.set("sample", source);

  assert.equal(store instanceof LocalPluginOverrideStore, true);
  assert.equal(written.get("sample"), pluginRoot);
  const restored = await store.resolve("sample");
  assert.equal(restored.installSpec, pluginRoot);
  assert.equal(restored.declaration, "local");
  const target = path.join(root, ".openspec-orch/cache/local-plugins.json");
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), {
    version: 1,
    plugins: { sample: pluginRoot },
  });
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.equal((await store.remove("sample")).has("sample"), false);
});

test("LocalPluginOverrideStore fails closed for unsafe or corrupted local state", async (t) => {
  const { checkout, pluginRoot, root } = await overrideFixture(t);
  const store = new LocalPluginOverrideStore(checkout);
  const source = PluginSource.parse(pluginRoot, { cwd: root });

  await assert.rejects(
    store.set("sample", PluginSource.parse("@test/plugin@1.0.0", { cwd: root })),
    /machine-local PluginSource/,
  );
  await store.set("sample", source);
  await fs.writeFile(
    path.join(root, ".openspec-orch/cache/local-plugins.json"),
    "{broken",
    "utf8",
  );
  await assert.rejects(store.read(), /LOCAL_PLUGIN_OVERRIDE_INVALID/);

  await fs.rm(path.join(root, ".openspec-orch"), { recursive: true });
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, ".openspec-orch"));
  await assert.rejects(store.read(), /небезопасный segment/);
});
