/** @fileoverview Public contract for the minimal Change Tracking Plugin. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPluginContract,
  testPluginContract,
} from "@openspec-orch/plugin-sdk/testing";

import * as publicApi from "../index.js";
import plugin from "../index.js";
import { ChangeTrackingApplication } from "../lib/application.js";
import packageManifest from "../package.json" with { type: "json" };
import { assignmentContext } from "../fixtures/assignment-context.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

testPluginContract({ plugin, packageManifest });

test("change-tracking contributes one workflow and Code Repository guidance", () => {
  assert.deepEqual(
    assertPluginContract({ plugin, packageManifest }).commands,
    ["start", "checkpoint", "complete", "cancel", "status"],
  );
  assert.equal(plugin.canExec(), true);
  assert.equal(plugin.hasExtensionContribution(), true);
  assert.deepEqual(plugin.extensions({
    repository: Object.freeze({ id: "frontend", role: "code" }),
  }).map(({ id, root, target }) => ({ id, root, target })), [{
    id: "agent",
    root: "./extension",
    target: { id: "frontend", role: "code" },
  }]);
  assert.deepEqual(plugin.extensions({
    repository: Object.freeze({ id: "specs", role: "store" }),
  }), []);
  assert.deepEqual(Object.keys(publicApi), ["default"]);
});

test("change-tracking requires the OpenSpec 1.11 task API", async () => {
  const incompatible = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
    openSpecVersion: "1.10.0",
  });
  await assert.rejects(plugin.connect(incompatible), /OPENSPEC_11_REQUIRED.*1\.10\.0/u);
  await assert.rejects(
    new ChangeTrackingApplication(incompatible).start({ change_id: "checkout-flow", task_id: "1" }),
    /OPENSPEC_11_REQUIRED.*1\.10\.0/u,
  );
});

test("change-tracking ships schema-neutral Apply guidance for every Agent", async () => {
  const extensionRoot = path.join(packageRoot, "extension");
  const [qwen, gigacode, claude, marketplace] = await Promise.all([
    fs.readFile(path.join(extensionRoot, "qwen-extension.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, "gigacode-extension.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, ".claude-plugin/plugin.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, ".claude-plugin/marketplace.json"), "utf8").then(JSON.parse),
  ]);

  assert.equal(qwen.name, "change-tracking-agent");
  assert.equal(qwen.contextFileName, "agent-instructions.md");
  assert.deepEqual(gigacode, qwen);
  assert.equal(claude.name, "change-tracking-agent");
  assert.equal(marketplace.name, "openspec-orch-change-tracking-agent");
  await fs.access(path.join(extensionRoot, qwen.contextFileName));
});
