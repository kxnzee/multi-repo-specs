/** @fileoverview Проверки distribution-owned Plugin provider. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BundledPluginPackage,
  BundledPluginProvider,
  PluginInstallation,
  PluginSource,
} from "@openspec-orch/core";

import { SAMPLE_PLUGIN_ROOT } from "./helpers/plugin-materializer.js";

/** Создаёт definition SDK sample Plugin из дистрибутива. */
function samplePackage(overrides = {}) {
  return new BundledPluginPackage({
    id: "sample",
    name: "Sample Plugin",
    packageName: "@test/openspec-orch-plugin-sample",
    packageRoot: SAMPLE_PLUGIN_ROOT,
    version: "1.0.0",
    ...overrides,
  });
}

test("BundledPluginProvider exposes catalog and loads the validated package in place", async () => {
  const provider = new BundledPluginProvider([samplePackage()]);
  const [entry] = provider.catalog.entries;

  const installation = await provider.install(entry.id, entry.source);

  assert.equal(installation instanceof PluginInstallation, true);
  assert.equal(installation.id, "sample");
  assert.equal(installation.version, "1.0.0");
  assert.equal(installation.loadedPlugin.root, SAMPLE_PLUGIN_ROOT);
  assert.equal(installation.loadedPlugin.id, "sample");
  assert.equal(installation.source.kind, "bundled");
  assert.equal(provider.has("sample", entry.source.declaration), true);
});

test("BundledPluginProvider rejects unknown sources and mismatched package identity", async () => {
  const provider = new BundledPluginProvider([samplePackage()]);

  await assert.rejects(
    provider.install("sample", PluginSource.bundled({ name: "@test/other", version: "1.0.0" })),
    /не входит в дистрибутив/,
  );
  await assert.rejects(
    new BundledPluginProvider([samplePackage({
      packageName: "@test/not-the-sample-package",
    })]).install("sample", PluginSource.bundled({
      name: "@test/not-the-sample-package",
      version: "1.0.0",
    })),
    /package identity/,
  );
});
