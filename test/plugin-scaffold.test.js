/** @fileoverview Контракт независимой регистрации Plugin Package. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { registerPluginPackage } from "../src/internal/plugin/index.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

const require = createRequire(import.meta.url);

test("registerPluginPackage creates a complete standalone package", async (t) => {
  const workspace = await temporaryDirectory(t, "openspec-orchestrator-plugin-register-");
  const targetRoot = path.join(workspace, "plugins", "dependency-audit");

  const result = await registerPluginPackage({
    pluginId: "dependency-audit",
    targetRoot,
    name: "Dependency Audit",
    supports: ["store", "code", "code"],
  });

  assert.equal(result.root, targetRoot);
  assert.equal(result.entrypoint, path.join(targetRoot, "bin", "dependency-audit.js"));
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(targetRoot, "package.json"),
    "utf8",
  ));
  assert.equal(packageManifest.name, "openspec-orch-plugin-dependency-audit");
  assert.equal(packageManifest.openspecOrchestrator.entrypoint, "bin/dependency-audit.js");
  assert.match(
    await fs.readFile(path.join(targetRoot, "plugin.yaml"), "utf8"),
    /supports:\n {2}- store\n {2}- code/,
  );
  assert.match(
    await fs.readFile(result.entrypoint, "utf8"),
    /const \[operation\] = process\.argv\.slice\(2\)/,
  );
  assert.equal((await fs.stat(result.entrypoint)).mode & 0o111, 0o111);
});

test("registerPluginPackage refuses reserved IDs and existing targets", async (t) => {
  const workspace = await temporaryDirectory(t, "openspec-orchestrator-plugin-register-");
  await assert.rejects(
    registerPluginPackage({ pluginId: "status", targetRoot: path.join(workspace, "status") }),
    /PLUGIN_ID_RESERVED/,
  );
  const targetRoot = path.join(workspace, "plugins", "demo");
  await registerPluginPackage({ pluginId: "demo", targetRoot });
  await assert.rejects(
    registerPluginPackage({ pluginId: "demo", targetRoot }),
    /PLUGIN_TARGET_EXISTS/,
  );
});

test("Core and Template contain no bundled Plugin-specific integration", async () => {
  const distribution = JSON.parse(await fs.readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  const pluginIds = await Promise.all(
    distribution.openspecOrchestrator.bundledPlugins.map(async (packageName) => {
      const packageRoot = path.dirname(require.resolve(`${packageName}/package.json`));
      return parse(await fs.readFile(path.join(packageRoot, "plugin.yaml"), "utf8")).id;
    }),
  );
  const visit = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = new URL(entry.name, directory.href.endsWith("/") ? directory : new URL(`${directory.href}/`));
      if (entry.isDirectory()) await visit(new URL(`${target.href}/`));
      else if (entry.isFile()) {
        const contents = await fs.readFile(target, "utf8");
        for (const pluginId of pluginIds) {
          assert.equal(contents.toLowerCase().includes(pluginId), false, target.pathname);
        }
      }
    }
  };
  await visit(new URL("../src/", import.meta.url));
  await visit(new URL("../templates/", import.meta.url));
});
