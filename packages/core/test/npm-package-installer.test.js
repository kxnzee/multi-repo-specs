/** @fileoverview Проверки безопасной npm execution boundary Plugin Installer. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NpmPackageInstaller,
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
  const installer = new NpmPackageInstaller({
    executor: async (...args) => {
      calls.push(args);
      return { failed: false, stderr: "", stdout: "installed" };
    },
    timeout: 5_000,
  });

  const result = await installer.install({ source: "@scope/plugin@1.2.3", runtimeRoot: root });

  assert.equal(result, "installed");
  assert.deepEqual(calls, [["npm", [
    "install",
    "--prefix", root,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    "--install-links",
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
  await new NpmPackageInstaller({
    environment: { NPM_CONFIG_CACHE: path.join(runtimeRoot, ".npm-cache") },
  }).install({ source: packageRoot, runtimeRoot });

  const installedRoot = path.join(runtimeRoot, "node_modules", "@test", "local-plugin");
  const stat = await fs.lstat(installedRoot);
  assert.equal(stat.isDirectory(), true);
  assert.equal(stat.isSymbolicLink(), false);
  await assert.rejects(fs.access(path.join(installedRoot, "INSTALL_SCRIPT_RAN")), /ENOENT/);
});

test("NpmPackageInstaller rejects invalid input and npm failures", async (t) => {
  const root = await runtimeFixture(t);
  await assert.rejects(
    new NpmPackageInstaller().install({
      source: "plugin@1.0.0",
      runtimeRoot: "relative",
    }),
    /runtimeRoot должен быть абсолютным/,
  );
  await assert.rejects(
    new NpmPackageInstaller({
      executor: async () => ({ failed: true, exitCode: 7, stderr: "registry unavailable" }),
    }).install({
      source: "plugin@1.0.0",
      runtimeRoot: root,
    }),
    /NPM_PACKAGE_FAILED.*кодом 7.*registry unavailable/s,
  );
});

test("NpmPackageInstaller restores the lock with the install-links mode used at install", async (t) => {
  const root = await runtimeFixture(t);
  const calls = [];
  await new NpmPackageInstaller({
    executor: async (_command, args) => {
      calls.push(args);
      return { failed: false, stderr: "", stdout: "" };
    },
  }).sync({ runtimeRoot: root });

  assert.deepEqual(calls, [[
    "ci",
    "--prefix", root,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--install-links",
  ]]);
});
