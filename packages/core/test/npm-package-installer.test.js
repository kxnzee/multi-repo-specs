/** @fileoverview Проверки безопасной npm execution boundary Plugin Installer. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NpmPackageInstaller,
  NpmPackageInstallResult,
  PluginSource,
} from "@openspec-orch/core";

/** Создаёт изолированный runtime и очищает его после теста. */
async function runtimeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-npm-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), "{\"private\":true}\n");
  return fs.realpath(root);
}

test("NpmPackageInstaller builds a fixed shell-free npm invocation", async (t) => {
  const root = await runtimeFixture(t);
  const calls = [];
  const source = PluginSource.parse("@scope/plugin@1.2.3", { cwd: root });
  const installer = new NpmPackageInstaller({
    executor: async (...args) => {
      calls.push(args);
      return { failed: false, stderr: "", stdout: "installed" };
    },
    timeout: 5_000,
  });

  const result = await installer.install({ source, runtimeRoot: root });

  assert.equal(result instanceof NpmPackageInstallResult, true);
  assert.equal(result.runtimeRoot, root);
  assert.equal(result.source, source);
  assert.equal(result.stdout, "installed");
  assert.deepEqual(calls, [["npm", [
    "install",
    "--prefix", root,
    "--save-exact",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--", "@scope/plugin@1.2.3",
  ], {
    cwd: root,
    env: {
      GIT_TERMINAL_PROMPT: "0",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
    reject: false,
    shell: false,
    stdin: "ignore",
    timeout: 5_000,
  }]]);
});

test("NpmPackageInstaller materializes a local package and never runs lifecycle scripts", async (t) => {
  const runtimeRoot = await runtimeFixture(t);
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-local-plugin-"));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@test/local-plugin",
    version: "1.0.0",
    scripts: { install: "node install.js" },
  }, null, 2)}\n`);
  await fs.writeFile(
    path.join(packageRoot, "install.js"),
    "require('node:fs').writeFileSync('INSTALL_SCRIPT_RAN', 'unsafe');\n",
  );
  const source = PluginSource.parse(packageRoot, { cwd: runtimeRoot });

  await new NpmPackageInstaller({
    environment: { NPM_CONFIG_CACHE: path.join(runtimeRoot, ".npm-cache") },
  }).install({ source, runtimeRoot });

  const installedRoot = path.join(runtimeRoot, "node_modules", "@test", "local-plugin");
  const stat = await fs.lstat(installedRoot);
  assert.equal(stat.isDirectory(), true);
  assert.equal(stat.isSymbolicLink(), false);
  await assert.rejects(fs.access(path.join(installedRoot, "INSTALL_SCRIPT_RAN")), /ENOENT/);
});

test("NpmPackageInstaller rejects bundled sources, invalid runtime and npm failures", async (t) => {
  const root = await runtimeFixture(t);
  const bundled = PluginSource.bundled({ name: "@scope/bundled", version: "1.0.0" });
  await assert.rejects(
    new NpmPackageInstaller().install({ source: bundled, runtimeRoot: root }),
    /PLUGIN_INSTALL_INVALID.*installable/,
  );
  await assert.rejects(
    new NpmPackageInstaller().install({
      source: PluginSource.parse("plugin@1.0.0", { cwd: root }),
      runtimeRoot: path.join(root, "missing"),
    }),
    /runtimeRoot не существует/,
  );
  await assert.rejects(
    new NpmPackageInstaller({
      executor: async () => ({ failed: true, exitCode: 7, stderr: "registry unavailable" }),
    }).install({
      source: PluginSource.parse("plugin@1.0.0", { cwd: root }),
      runtimeRoot: root,
    }),
    /PLUGIN_INSTALL_FAILED.*кодом 7.*registry unavailable/s,
  );
});
