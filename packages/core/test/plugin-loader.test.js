/** @fileoverview Проверки безопасного Core Plugin Loader. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LoadedPlugin,
  PluginLoader,
} from "@openspec-orch/core";

import { createDirectoryLink } from "../fixtures/filesystem.js";

const SAMPLE_ROOT = await fs.realpath(fileURLToPath(
  new URL("../../../test-fixtures/plugin-sdk/sample-plugin/", import.meta.url),
));

/** Создаёт валидный package contract в независимом временном каталоге. */
async function packageFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-loader-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = {
    name: "@test/openspec-orch-plugin-external",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  };
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(root, "index.js"), "export default {};\n");
  return root;
}

/** Возвращает структурно валидный export без зависимости от SDK instanceof. */
function externalPlugin(id = "external", calls = []) {
  const untouched = (name) => () => calls.push(name);
  return Object.freeze({
    id,
    supports: Object.freeze(["code"]),
    supportsRole: untouched("supportsRole"),
    assertSupports: untouched("assertSupports"),
    hasRepositoryContribution: untouched("hasRepositoryContribution"),
    connect: untouched("connect"),
    status: untouched("status"),
    canSync: untouched("canSync"),
    sync: untouched("sync"),
    hasAgentContribution: untouched("hasAgentContribution"),
    integrateAgent: untouched("integrateAgent"),
    hasCommandContribution: untouched("hasCommandContribution"),
    registerCommands: untouched("registerCommands"),
  });
}

test("PluginLoader imports a validated SDK Plugin without running contributions", async () => {
  const loaded = await new PluginLoader().load({ packageRoot: SAMPLE_ROOT, pluginId: "sample" });

  assert.equal(loaded instanceof LoadedPlugin, true);
  assert.equal(loaded.id, "sample");
  assert.deepEqual(loaded.supports, ["code"]);
  assert.equal(loaded.package.name, "@test/openspec-orch-plugin-sample");
  assert.equal(loaded.package.version, "1.0.0");
  assert.equal(loaded.root, SAMPLE_ROOT);
  assert.equal(loaded.entrypoint, path.join(SAMPLE_ROOT, "index.js"));
});

test("PluginLoader validates an external plain export structurally without invoking its methods", async (t) => {
  const root = await packageFixture(t);
  const calls = [];
  const plugin = externalPlugin("external", calls);
  const loaded = await new PluginLoader(async () => ({ default: plugin })).load({
    packageRoot: root,
    pluginId: "external",
  });

  assert.equal(loaded.plugin, plugin);
  assert.deepEqual(calls, []);
});

test("PluginLoader rejects package and entrypoint problems before import", async (t) => {
  const root = await packageFixture(t);
  let imports = 0;
  const loader = new PluginLoader(async () => {
    imports += 1;
    return { default: externalPlugin() };
  });
  await fs.rm(path.join(root, "index.js"));
  const outside = path.join(root, "outside-entrypoint");
  await fs.mkdir(outside);
  await createDirectoryLink(outside, path.join(root, "index.js"));

  await assert.rejects(
    loader.load({ packageRoot: root, pluginId: "external" }),
    /entrypoint|index\.js.*symlink/,
  );
  assert.equal(imports, 0);

  await fs.rm(path.join(root, "package.json"));
  await fs.writeFile(path.join(root, "package.json"), "not json");
  await assert.rejects(loader.load({ packageRoot: root, pluginId: "external" }), /некорректный JSON/);
  assert.equal(imports, 0);
});

test("PluginLoader rejects invalid API and mismatched Plugin identity", async (t) => {
  const root = await packageFixture(t);
  await assert.rejects(
    new PluginLoader(async () => ({
      default: Object.freeze({ id: "external", supports: Object.freeze([]) }),
    })).load({
      packageRoot: root,
      pluginId: "external",
    }),
    /не предоставляет метод supportsRole/,
  );
  await assert.rejects(
    new PluginLoader(async () => ({ default: { ...externalPlugin("external") } })).load({
      packageRoot: root,
      pluginId: "external",
    }),
    /должны быть immutable/,
  );
  await assert.rejects(
    new PluginLoader(async () => ({ default: externalPlugin("another") })).load({
      packageRoot: root,
      pluginId: "external",
    }),
    /ожидался plugin-id external.*another/,
  );
  assert.throws(() => new LoadedPlugin(), /LOADED_PLUGIN_INVALID/);
});
