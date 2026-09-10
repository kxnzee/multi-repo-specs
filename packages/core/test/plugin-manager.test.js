/** @fileoverview Проверки тонкого Plugin adapter над npm package supply. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRepository,
  createRepositoryCheckout,
  PluginInstallation,
  PluginManagerService,
  PluginSource,
} from "@openspec-orch/core";

import { SAMPLE_PLUGIN_ROOT } from "../fixtures/plugin-materializer.js";

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

test("PluginManager does not shadow a bundled Plugin with an external package", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const manager = new PluginManagerService({
    bundledProvider: {
      has(pluginId) { return pluginId === "sample"; },
      async install() {},
      async resolve() {},
    },
    supplyService: { forStore() { return {}; } },
  }).forStore(checkout);

  await assert.rejects(
    manager.install("sample", PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root })),
    /встроенный Plugin нельзя заменить через --from/,
  );
});

test("PluginInstallation remains manager-owned", () => {
  assert.throws(() => new PluginInstallation(), /используйте Plugin Manager/);
});
