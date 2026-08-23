/** @fileoverview Проверки read-only восстановления Plugin runtime из receipt. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createProject,
  createRepositoryCheckout,
  LocalPluginOverrideService,
  PluginDeclaration,
  PluginInstallerService,
  PluginRuntimeService,
  PluginSource,
  ResolvedPluginRuntime,
  StorePluginRuntimeResolver,
} from "@openspec-orch/core";

import {
  createPluginMaterializer,
  SAMPLE_PLUGIN_ROOT,
} from "./helpers/plugin-materializer.js";

/** Создаёт Store checkout и v3 Plugin declaration. */
async function runtimeFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-runtime-resolve-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [{ id: "sample", source: "local" }],
    repositories: [{
      id: "specs",
      role: "store",
      remote: "https://example.test/specs.git",
      defaultBranch: "main",
      plugins: [],
    }],
  });
  return {
    checkout: createRepositoryCheckout(project.storeRepository, root),
    declaration: project.pluginDeclaration("sample"),
    root,
    source: PluginSource.parse(SAMPLE_PLUGIN_ROOT, { cwd: root }),
  };
}

test("PluginRuntimeService restores a validated local Plugin from its receipt", async (t) => {
  const fixture = await runtimeFixture(t);
  await new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(fixture.checkout).install("sample", fixture.source);
  await new LocalPluginOverrideService().forStore(fixture.checkout).set("sample", fixture.source);
  const resolver = new PluginRuntimeService().forStore(fixture.checkout);

  const runtime = await resolver.resolve(fixture.declaration);

  assert.equal(resolver instanceof StorePluginRuntimeResolver, true);
  assert.equal(runtime instanceof ResolvedPluginRuntime, true);
  assert.equal(runtime.loadedPlugin.id, "sample");
  assert.equal(runtime.record.version, "1.0.0");
  assert.equal(runtime.root, path.join(
    fixture.root,
    ".openspec-orch/cache/plugin-runtimes/sample/1.0.0",
  ));
});

test("PluginRuntimeResolver requires local override before loading runtime", async (t) => {
  const fixture = await runtimeFixture(t);
  await new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(fixture.checkout).install("sample", fixture.source);

  await assert.rejects(
    new StorePluginRuntimeResolver(fixture.checkout).resolve(fixture.declaration),
    (error) => {
      assert.match(error.message, /local source недоступен/);
      assert.equal(error.code, "PLUGIN_RUNTIME_UNAVAILABLE");
      return true;
    },
  );
});

test("PluginRuntimeResolver fails closed for ambiguous local runtime versions", async (t) => {
  const fixture = await runtimeFixture(t);
  await new LocalPluginOverrideService().forStore(fixture.checkout).set("sample", fixture.source);
  await new PluginInstallerService({
    npmInstaller: createPluginMaterializer(),
  }).forStore(fixture.checkout).install("sample", fixture.source);
  await new PluginInstallerService({
    npmInstaller: createPluginMaterializer({ version: "2.0.0" }),
  }).forStore(fixture.checkout).install("sample", fixture.source);

  await assert.rejects(
    new StorePluginRuntimeResolver(fixture.checkout).resolve(fixture.declaration),
    /несколько runtime/,
  );
  await assert.rejects(
    new StorePluginRuntimeResolver(fixture.checkout).resolve({ id: "sample" }),
    /требуется PluginDeclaration/,
  );
  assert.equal(fixture.declaration instanceof PluginDeclaration, true);
});
