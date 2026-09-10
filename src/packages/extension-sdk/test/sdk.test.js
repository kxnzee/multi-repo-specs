/** @fileoverview Публичный Extension SDK contract. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

import {
  ExtensionDescriptor,
  ExtensionPackage,
} from "@openspec-orch/extension-sdk";
import {
  assertExtensionContract,
  testExtensionContract,
} from "@openspec-orch/extension-sdk/testing";

const SAMPLE_ROOT = new URL("../../../../test-fixtures/extension-sdk/sample-extension/", import.meta.url);
const packageManifest = JSON.parse(await fs.readFile(new URL("package.json", SAMPLE_ROOT), "utf8"));
const descriptor = parse(await fs.readFile(new URL("extension.yaml", SAMPLE_ROOT), "utf8"));

test("Extension SDK validates an independent Extension package fixture", async () => {
  const extensionPackage = new ExtensionPackage(packageManifest);
  const extension = new ExtensionDescriptor(descriptor, { agentIds: ["claude", "gigacode", "qwen"] });

  assert.deepEqual(extensionPackage.identity(), {
    name: "@test/openspec-orch-extension-sample",
    version: "1.0.0",
    extension: "./extension.yaml",
  });
  assert.equal(extension.id, "sample-extension");
  assert.equal(Object.isFrozen(extension.manifests), true);
  await Promise.all(Object.values(descriptor.manifests).map((manifest) => (
    fs.access(new URL(manifest, SAMPLE_ROOT))
  )));
  assert.deepEqual(assertExtensionContract({
    agentIds: ["claude", "gigacode", "qwen"],
    descriptor,
    packageManifest,
  }).id, "sample-extension");
});

test("Extension SDK rejects executable or incomplete package declarations", () => {
  assert.throws(() => new ExtensionPackage({
    ...packageManifest,
    openspecOrchestrator: { apiVersion: 1, extension: "./index.js" },
  }), /extension\.yaml/);
  assert.throws(() => new ExtensionDescriptor({
    ...descriptor,
    connect() {},
  }, { agentIds: ["claude", "qwen"] }), /только id, manifests, name/);
  assert.throws(() => new ExtensionDescriptor(descriptor, {
    agentIds: ["claude"],
  }), /неизвестный Agent 'qwen'/);
  assert.deepEqual(
    new ExtensionDescriptor({ ...descriptor, manifests: { qwen: "qwen-extension.json" } }, {
      agentIds: ["claude", "qwen"],
    }).manifests,
    { qwen: "qwen-extension.json" },
  );
  assert.throws(() => new ExtensionDescriptor({
    ...descriptor,
    manifests: { qwen: "./qwen-extension.json" },
  }, { agentIds: ["qwen"] }), /безопасным относительным POSIX path/);
});

testExtensionContract({
  agentIds: ["claude", "gigacode", "qwen"],
  descriptor,
  packageManifest,
});


test("Extension descriptor keeps Store default and accepts explicit repository roles", () => {
  const descriptor = { id: "workflow", name: "Workflow", manifests: { qwen: "qwen-extension.json" } };
  assert.deepEqual(new ExtensionDescriptor(descriptor, { agentIds: ["qwen"] }).targets, ["store"]);
  assert.deepEqual(new ExtensionDescriptor({ ...descriptor, targets: ["store", "code"] }, { agentIds: ["qwen"] }).targets, ["store", "code"]);
  for (const targets of [null, [], ["user"], ["code", "code"], "code"]) {
    assert.throws(() => new ExtensionDescriptor({ ...descriptor, targets }, { agentIds: ["qwen"] }), /targets/);
  }
});
