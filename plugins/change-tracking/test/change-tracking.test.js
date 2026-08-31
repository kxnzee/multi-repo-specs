/** @fileoverview Public contract for the minimal Change Tracking Plugin. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPluginContract,
  testPluginContract,
} from "@openspec-orch/plugin-sdk/testing";

import * as publicApi from "../index.js";
import plugin from "../index.js";
import { AttemptTrackingService } from "../lib/attempt-service.js";
import packageManifest from "../package.json" with { type: "json" };
import { assignmentContext } from "./assignment-context.js";

testPluginContract({ plugin, packageManifest });

test("change-tracking contributes only the task attempt command", () => {
  assert.deepEqual(
    assertPluginContract({ plugin, packageManifest }).commands,
    ["attempt"],
  );
  assert.equal(plugin.canExec(), true);
  assert.equal(plugin.hasExtensionContribution(), false);
  assert.deepEqual(Object.keys(publicApi), ["default"]);
});

test("change-tracking requires the OpenSpec 1.11 task API", async () => {
  const incompatible = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
    openSpecVersion: "1.10.0",
  });
  await assert.rejects(plugin.connect(incompatible), /OPENSPEC_11_REQUIRED.*1\.10\.0/u);
  await assert.rejects(
    new AttemptTrackingService(incompatible).start({ changeId: "checkout-flow", taskId: "1" }),
    /OPENSPEC_11_REQUIRED.*1\.10\.0/u,
  );
});
