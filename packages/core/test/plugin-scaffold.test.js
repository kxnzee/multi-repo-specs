/** @fileoverview Проверки нативного scaffold пользовательского Plugin. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { execa } from "execa";
import { PluginLoader, PluginScaffoldService } from "@openspec-orch/core";

import { PLUGIN_SDK_ROOT } from "./helpers/plugin-materializer.js";

/** Делает публичный SDK доступным созданному локальному package без npm registry. */
async function linkSdk(packageRoot) {
  const scope = path.join(packageRoot, "node_modules", "@openspec-orch");
  await fs.mkdir(scope, { recursive: true });
  await fs.symlink(PLUGIN_SDK_ROOT, path.join(scope, "plugin-sdk"), "dir");
}

test("PluginScaffoldService creates a native SDK package without legacy files", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-scaffold-"));
  const targetRoot = path.join(temporary, "dependency-audit");
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await new PluginScaffoldService().register({
    pluginId: "dependency-audit",
    targetRoot,
    name: "Dependency Audit",
    supports: ["store", "code", "code"],
  });

  const canonicalRoot = await fs.realpath(targetRoot);
  assert.equal(result.root, canonicalRoot);
  assert.equal(result.entrypoint, path.join(canonicalRoot, "index.js"));
  assert.deepEqual((await fs.readdir(targetRoot)).sort(), [
    "README.md",
    "index.js",
    "package.json",
    "test",
  ]);
  assert.equal(await fs.lstat(path.join(targetRoot, "plugin.yaml")).catch((error) => error.code), "ENOENT");
  assert.equal(await fs.lstat(path.join(targetRoot, "bin")).catch((error) => error.code), "ENOENT");

  const manifest = JSON.parse(await fs.readFile(path.join(targetRoot, "package.json"), "utf8"));
  assert.equal(manifest.exports, "./index.js");
  assert.deepEqual(manifest.openspecOrchestrator, { apiVersion: 1, plugin: "./index.js" });
  assert.equal(manifest.peerDependencies["@openspec-orch/plugin-sdk"], "^0.1.0");

  await linkSdk(targetRoot);
  const loaded = await new PluginLoader().load({
    packageRoot: await fs.realpath(targetRoot),
    pluginId: "dependency-audit",
  });
  assert.deepEqual(loaded.supports, ["store", "code"]);
  const contract = await execa(process.execPath, ["--test"], { cwd: targetRoot, reject: false });
  assert.equal(contract.exitCode, 0, contract.stderr || contract.stdout);
});

test("PluginScaffoldService rejects invalid, reserved and existing targets", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-scaffold-errors-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const scaffolds = new PluginScaffoldService();

  await assert.rejects(
    scaffolds.register({ pluginId: "Invalid", targetRoot: path.join(temporary, "invalid") }),
    /PLUGIN_ID_INVALID/,
  );
  await assert.rejects(
    scaffolds.register({ pluginId: "plugin", targetRoot: path.join(temporary, "reserved") }),
    /PLUGIN_ID_RESERVED/,
  );
  await fs.mkdir(path.join(temporary, "existing"));
  await assert.rejects(
    scaffolds.register({ pluginId: "sample", targetRoot: path.join(temporary, "existing") }),
    /PLUGIN_TARGET_EXISTS/,
  );
});
