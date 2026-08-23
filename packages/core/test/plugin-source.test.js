/** @fileoverview Проверки минимальной модели Plugin source. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { PluginSource } from "@openspec-orch/core";

const CWD = path.resolve("test-fixtures");

test("PluginSource passes npm-compatible sources through without classifying them", () => {
  for (const specifier of [
    "@scope/plugin@1.2.3",
    "https://packages.example.test/plugin.tgz",
    "git+https://example.test/plugin.git#main",
  ]) {
    const source = PluginSource.parse(specifier, { cwd: CWD });
    assert.equal(source.kind, "external");
    assert.equal(source.declaration, specifier);
    assert.equal(source.installSpec, specifier);
    assert.equal(source.installable, true);
  }

  const local = PluginSource.parse("../plugin", { cwd: CWD });
  assert.equal(local.installSpec, path.resolve(CWD, "../plugin"));
  assert.equal(local.declaration, "../plugin");

  const bundled = PluginSource.bundled({ name: "@scope/bundled", version: "2.0.0" });
  assert.equal(bundled.kind, "bundled");
  assert.equal(bundled.installable, false);
  assert.equal(bundled.declaration, "@scope/bundled@2.0.0");
});

test("PluginSource only validates its own minimal boundary", () => {
  assert.throws(() => new PluginSource(), /PluginSource\.parse/);
  assert.throws(() => PluginSource.parse(" plugin ", { cwd: CWD }), /PLUGIN_SOURCE_INVALID/);
  assert.throws(() => PluginSource.parse("plugin\nnext", { cwd: CWD }), /однострочным/);
  assert.throws(
    () => PluginSource.parse("https://token@example.test/plugin.tgz", { cwd: CWD }),
    /credentials/,
  );
});
