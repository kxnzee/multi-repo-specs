/** @fileoverview Публичный Extension SDK contract. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTENSION_API_VERSION,
  ExtensionDescriptor,
  ExtensionPackage,
} from "@openspec-orch/extension-sdk";
import {
  assertExtensionContract,
  testExtensionContract,
} from "@openspec-orch/extension-sdk/testing";

const packageManifest = {
  name: "@test/workflow-extension",
  version: "1.2.3",
  openspecOrchestrator: {
    apiVersion: EXTENSION_API_VERSION,
    extension: "./extension.yaml",
  },
};
const descriptor = {
  id: "workflow",
  name: "Workflow",
  manifests: { claude: ".claude-plugin/plugin.json", qwen: "qwen-extension.json" },
};

test("Extension SDK validates package identity and portable manifests", () => {
  const extensionPackage = new ExtensionPackage(packageManifest);
  const extension = new ExtensionDescriptor(descriptor, { agentIds: ["claude", "qwen"] });

  assert.deepEqual(extensionPackage.identity(), {
    name: "@test/workflow-extension",
    version: "1.2.3",
    extension: "./extension.yaml",
  });
  assert.equal(extension.id, "workflow");
  assert.equal(Object.isFrozen(extension.manifests), true);
  assert.deepEqual(assertExtensionContract({
    agentIds: ["claude", "qwen"],
    descriptor,
    packageManifest,
  }).id, "workflow");
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
  agentIds: ["claude", "qwen"],
  descriptor,
  packageManifest,
});
