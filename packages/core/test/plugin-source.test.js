/** @fileoverview Проверки доменной модели источника Plugin package. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { PluginSource } from "@openspec-orch/core";

const CWD = path.resolve("test-fixtures");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("PluginSource accepts exact npm, tarball, Git commit, local and bundled sources", () => {
  const npm = PluginSource.parse("@scope/plugin@1.2.3", { cwd: CWD });
  assert.equal(npm.kind, "npm");
  assert.equal(npm.packageName, "@scope/plugin");
  assert.equal(npm.installSpec, "@scope/plugin@1.2.3");
  assert.equal(npm.declaration, "@scope/plugin@1.2.3");

  const tarball = PluginSource.parse("./plugin.tgz", { cwd: CWD });
  assert.equal(tarball.kind, "tarball");
  assert.equal(tarball.installSpec, path.join(CWD, "plugin.tgz"));
  assert.equal(tarball.declaration, "file:plugin.tgz");

  const remote = PluginSource.parse("https://packages.example.test/plugin.tgz", { cwd: CWD });
  assert.equal(remote.kind, "tarball");
  assert.equal(remote.installSpec, "https://packages.example.test/plugin.tgz");

  const git = PluginSource.parse(`git+https://example.test/plugin.git#${COMMIT}`, { cwd: CWD });
  assert.equal(git.kind, "git");
  assert.match(git.declaration, new RegExp(`${COMMIT}$`));

  const local = PluginSource.parse("../plugin", { cwd: CWD });
  assert.equal(local.kind, "local");
  assert.equal(local.declaration, "local");
  assert.equal(local.developmentOnly, true);
  assert.equal(local.requiresInstallLinks, true);

  const bundled = PluginSource.bundled({ name: "@scope/bundled", version: "2.0.0" });
  assert.equal(bundled.kind, "bundled");
  assert.equal(bundled.installable, false);
  assert.equal(bundled.declaration, "@scope/bundled@2.0.0");
});

test("PluginSource rejects floating and credential-bearing sources", () => {
  assert.throws(() => new PluginSource(), /PluginSource\.parse/);
  for (const specifier of [
    "plugin",
    "plugin@latest",
    "plugin@^1.0.0",
    "git+https://example.test/plugin.git#main",
    "git+https://example.test/plugin.git",
  ]) {
    assert.throws(() => PluginSource.parse(specifier, { cwd: CWD }), /PLUGIN_SOURCE_INVALID/);
  }
  assert.throws(
    () => PluginSource.parse(`git+https://token@example.test/plugin.git#${COMMIT}`, { cwd: CWD }),
    /credentials/,
  );
  assert.throws(
    () => PluginSource.parse("https://token@example.test/plugin.tgz", { cwd: CWD }),
    /credentials/,
  );
});
