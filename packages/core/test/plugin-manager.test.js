/** @fileoverview Проверки единого facade установки и загрузки Plugin package. */

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
  PluginLoader,
  PluginManagerService,
  PluginSource,
  StorePluginManager,
} from "@openspec-orch/core";

import {
  createPluginMaterializer,
  PLUGIN_SDK_VERSION,
  SAMPLE_PLUGIN_ROOT,
} from "./helpers/plugin-materializer.js";

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

test("PluginManager installs and restores one deterministic runtime per Plugin", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const manager = new PluginManagerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);

  const installed = await manager.install("sample", source);
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [{ id: "sample", source: installed.declaration }],
    repositories: [{
      id: "specs",
      role: "store",
      remote: "https://example.test/specs.git",
      defaultBranch: "main",
      plugins: [],
    }],
  });
  const restored = await manager.resolve(project.pluginDeclaration("sample"));

  assert.equal(manager instanceof StorePluginManager, true);
  assert.equal(installed instanceof PluginInstallation, true);
  assert.equal(installed.declaration, "@test/openspec-orch-plugin-sample@1.0.0");
  assert.equal(restored.loadedPlugin.id, "sample");
  assert.equal(restored.runtimeRoot, path.join(
    root,
    ".openspec-orch/cache/plugin-runtimes/sample",
  ));
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(restored.runtimeRoot, "package.json"))).dependencies,
    {
      "@openspec-orch/plugin-sdk": PLUGIN_SDK_VERSION,
      "@test/openspec-orch-plugin-sample": `file:${SAMPLE_PLUGIN_ROOT}`,
    },
  );
  assert.deepEqual(
    (await fs.readdir(path.dirname(restored.runtimeRoot))).filter((name) => name.startsWith(".install-")),
    [],
  );
  assert.throws(() => new PluginInstallation(), /используйте Plugin Manager/);
});

test("PluginManager preserves the previous runtime when replacement validation or publication fails", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const current = new PluginManagerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);
  const previous = await current.install("sample", source);
  const marker = path.join(previous.runtimeRoot, "preserved.txt");
  await fs.writeFile(marker, "original");
  const invalid = new PluginManagerService({
    loader: new PluginLoader(async () => ({ default: Object.freeze({}) })),
    npmInstaller: createPluginMaterializer({ version: "2.0.0" }),
  }).forStore(checkout);

  await assert.rejects(invalid.install("sample", source), /Plugin export id|не предоставляет метод/);

  assert.equal(await fs.readFile(marker, "utf8"), "original");
  assert.deepEqual(await fs.readdir(path.dirname(previous.runtimeRoot)), ["sample"]);

  await assert.rejects(
    current.install("sample", source, async () => { throw new Error("publish failed"); }),
    /publish failed/,
  );
  assert.equal(await fs.readFile(marker, "utf8"), "original");
  assert.deepEqual(await fs.readdir(path.dirname(previous.runtimeRoot)), ["sample"]);
});

test("PluginManager removes one runtime idempotently", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const manager = new PluginManagerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);
  await manager.install("sample", PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root }));

  assert.equal(await manager.remove("sample"), true);
  assert.equal(await manager.remove("sample"), false);
});

test("PluginManager fails closed for a busy lock and unsafe runtime directory", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  let installs = 0;
  const manager = new PluginManagerService({
    npmInstaller: { async install() { installs += 1; } },
  }).forStore(checkout);
  const lockPath = path.join(root, ".openspec-orch/cache/locks/plugin-installer.lock");
  await fs.mkdir(lockPath, { recursive: true });

  await assert.rejects(manager.install("sample", source), /PLUGIN_INSTALL_BUSY/);
  assert.equal(installs, 0);

  await fs.rmdir(lockPath);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-runtime-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, ".openspec-orch/cache/plugin-runtimes"));
  await assert.rejects(manager.install("sample", source), /небезопасный directory segment/);
  assert.equal(installs, 0);
});
