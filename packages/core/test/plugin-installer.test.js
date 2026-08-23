/** @fileoverview Проверки Store-scoped построения и активации Plugin runtime. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRepository,
  createRepositoryCheckout,
  PluginInstallation,
  PluginInstallerService,
  PluginLoader,
  PluginSource,
  StorePluginInstaller,
} from "@openspec-orch/core";

import {
  createPluginMaterializer,
  PLUGIN_SDK_VERSION,
  SAMPLE_PLUGIN_ROOT,
} from "./helpers/plugin-materializer.js";

/** Создаёт изолированный Store checkout. */
async function storeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-installer-"));
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

test("PluginInstaller atomically activates a validated immutable version runtime", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const service = new PluginInstallerService({ npmInstaller: createPluginMaterializer() });
  const installer = service.forStore(checkout);

  const installed = await installer.install("sample", source);

  assert.equal(installer instanceof StorePluginInstaller, true);
  assert.equal(installed instanceof PluginInstallation, true);
  assert.equal(installed.id, "sample");
  assert.equal(installed.version, "1.0.0");
  assert.equal(installed.reused, false);
  assert.equal(installed.record.pluginId, "sample");
  assert.equal(installed.record.source.kind, "local");
  assert.equal(installed.record.source.spec, "local");
  assert.equal(installed.record.dependencies.find(
    (dependency) => dependency.name === "@test/openspec-orch-plugin-sample",
  ).resolved, "local");
  assert.equal(installed.runtimeRoot, path.join(
    root,
    ".openspec-orch/cache/plugin-runtimes/sample/1.0.0",
  ));
  assert.equal(installed.loadedPlugin.root, path.join(
    installed.runtimeRoot,
    "node_modules/@test/openspec-orch-plugin-sample",
  ));
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(installed.runtimeRoot, "package.json"))).dependencies,
    {
      "@openspec-orch/plugin-sdk": PLUGIN_SDK_VERSION,
      "@test/openspec-orch-plugin-sample": `file:${SAMPLE_PLUGIN_ROOT}`,
    },
  );
  assert.equal((await fs.readdir(path.dirname(installed.runtimeRoot))).some(
    (name) => name.startsWith(".install-"),
  ), false);
  const receipt = await fs.readFile(path.join(installed.runtimeRoot, "installation.json"), "utf8");
  assert.equal(receipt.includes(SAMPLE_PLUGIN_ROOT), false);
});

test("PluginInstaller reuses the same valid version without replacing its runtime", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const installer = new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);
  const first = await installer.install("sample", source);
  const marker = path.join(first.runtimeRoot, "preserved.txt");
  await fs.writeFile(marker, "original");

  const second = await installer.install("sample", source);

  assert.equal(second.reused, true);
  assert.equal(second.runtimeRoot, first.runtimeRoot);
  assert.equal(await fs.readFile(marker, "utf8"), "original");
});

test("PluginInstaller removes all runtime versions idempotently", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const installer = new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);
  await installer.install("sample", source);

  assert.equal(await installer.remove("sample"), true);
  assert.equal(await fs.lstat(path.join(
    root,
    ".openspec-orch/cache/plugin-runtimes/sample",
  )).catch((error) => error.code), "ENOENT");
  assert.equal(await installer.remove("sample"), false);
});

test("PluginInstaller leaves previous version active and cleans temp after validation failure", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const valid = new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);
  const previous = await valid.install("sample", source);
  const invalid = new PluginInstallerService({
    npmInstaller: createPluginMaterializer({ version: "2.0.0" }),
    loader: new PluginLoader(async () => ({ default: Object.freeze({}) })),
  }).forStore(checkout);

  await assert.rejects(invalid.install("sample", source), /не предоставляет метод|Plugin export id/);

  assert.equal((await fs.lstat(previous.runtimeRoot)).isDirectory(), true);
  const pluginDirectory = path.dirname(previous.runtimeRoot);
  assert.deepEqual(await fs.readdir(pluginDirectory), ["1.0.0"]);
});

test("PluginInstaller removes a just-activated runtime when post-rename load fails", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  const loader = new PluginLoader();
  const failingLoader = {
    async load(options) {
      if (options.packageRoot.includes(`${path.sep}1.0.0${path.sep}`)) {
        throw new Error("post-rename import failed");
      }
      return loader.load(options);
    },
  };
  const installer = new PluginInstallerService({
    loader: failingLoader,
    npmInstaller: createPluginMaterializer(),
  }).forStore(checkout);

  await assert.rejects(installer.install("sample", source), /post-rename import failed/);

  const pluginDirectory = path.join(root, ".openspec-orch/cache/plugin-runtimes/sample");
  assert.deepEqual(await fs.readdir(pluginDirectory), []);
});

test("PluginInstaller fails closed for a busy lock and symlinked runtime cache", async (t) => {
  const { root, checkout } = await storeFixture(t);
  const source = PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root });
  let installs = 0;
  const npmInstaller = {
    async install() {
      installs += 1;
    },
  };
  const installer = new PluginInstallerService({ npmInstaller }).forStore(checkout);
  const lockPath = path.join(root, ".openspec-orch/cache/locks/plugin-installer.lock");
  await fs.mkdir(lockPath, { recursive: true });

  await assert.rejects(installer.install("sample", source), /PLUGIN_INSTALL_BUSY/);
  await assert.rejects(installer.remove("sample"), /PLUGIN_INSTALL_BUSY/);
  assert.equal(installs, 0);

  await fs.rmdir(lockPath);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-runtime-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const runtimeDirectory = path.join(root, ".openspec-orch/cache/plugin-runtimes");
  await fs.symlink(outside, runtimeDirectory);
  await assert.rejects(installer.install("sample", source), /небезопасный directory segment/);
  await assert.rejects(installer.remove("sample"), /небезопасный segment/);
  assert.equal(installs, 0);
  assert.deepEqual(await fs.readdir(outside), []);
});
