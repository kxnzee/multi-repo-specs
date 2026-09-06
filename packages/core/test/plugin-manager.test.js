/** @fileoverview Проверки тонкого Plugin adapter над npm package supply. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createProject,
  createRepository,
  createRepositoryCheckout,
  PluginInstallation,
  PluginManagerService,
  PluginSource,
  StorePluginManager,
} from "@openspec-orch/core";

import { SAMPLE_PLUGIN_ROOT } from "./helpers/plugin-materializer.js";

/** Создаёт изолированный Store checkout. */
async function storeFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-manager-")));
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

/** Возвращает наблюдаемый package supply без npm процесса. */
function supplyFixture(calls) {
  return {
    forStore() {
      return {
        async install(options) {
          calls.push({ operation: "install", ...options });
          const value = await options.validate(SAMPLE_PLUGIN_ROOT);
          await options.publish(value);
          return value;
        },
        async resolve(kind, id) {
          calls.push({ operation: "resolve", kind, id });
          return {
            packageName: "@test/openspec-orch-plugin-sample",
            packageRoot: SAMPLE_PLUGIN_ROOT,
            runtimeRoot: path.dirname(SAMPLE_PLUGIN_ROOT),
            version: "1.0.0",
          };
        },
        async remove(kind, id, publish) {
          calls.push({ operation: "remove", kind, id });
          await publish();
          return true;
        },
      };
    },
  };
}

test("PluginManager validates packages supplied by the shared npm project", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const calls = [];
  const manager = new PluginManagerService({ supplyService: supplyFixture(calls) }).forStore(checkout);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const installed = await manager.install("sample", source);
  const project = createProject({
    version: 1,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: ["sample"],
    repositories: [{ ...checkout.repository.toConfig(), plugins: [] }],
  });
  const restored = await manager.resolve(project.pluginDeclaration("sample"));

  assert.equal(manager instanceof StorePluginManager, true);
  assert.equal(installed instanceof PluginInstallation, true);
  assert.equal(installed.id, "sample");
  assert.equal(restored.loadedPlugin.id, "sample");
  assert.equal(restored.runtimeRoot, SAMPLE_PLUGIN_ROOT);
  assert.deepEqual(calls.map(({ operation }) => operation), ["install", "resolve"]);
});

test("PluginManager delegates external removal to the shared supply", async (t) => {
  const { checkout } = await storeFixture(t);
  const calls = [];
  const manager = new PluginManagerService({ supplyService: supplyFixture(calls) }).forStore(checkout);
  let published = false;

  assert.equal(await manager.remove("sample", async () => { published = true; }), true);
  assert.equal(published, true);
  assert.deepEqual(calls.map(({ operation, kind, id }) => ({ operation, kind, id })), [{
    operation: "remove",
    kind: "plugins",
    id: "sample",
  }]);
});

test("PluginManager does not shadow a bundled Plugin with an external package", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const manager = new PluginManagerService({
    bundledProvider: {
      has(pluginId) { return pluginId === "sample"; },
      async install() {},
      async resolve() {},
    },
    supplyService: supplyFixture([]),
  }).forStore(checkout);

  await assert.rejects(
    manager.install("sample", PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root })),
    /встроенный Plugin нельзя заменить через --from/,
  );
});

test("PluginInstallation remains manager-owned", () => {
  assert.throws(() => new PluginInstallation(), /используйте Plugin Manager/);
});
