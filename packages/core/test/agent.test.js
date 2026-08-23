/** @fileoverview Проверки общего coordinator Agent contributions. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentIntegration, AgentService, storeProjects } from "@openspec-orch/core";

/** Создаёт Store с одним Agent и установленным sample Plugin. */
async function storeFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-agent-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), `version: 3
strict: true
agents: [codex]
plugins:
  - id: sample
    source: "@test/plugin-sample@1.0.0"
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: []
`);
  return storeProjects.load(root);
}

test("AgentService resolves and executes a Plugin contribution through its context", async (t) => {
  const storeProject = await storeFixture(t);
  const calls = [];
  const context = Object.freeze({ agent: Object.freeze({ id: "codex" }) });
  const service = new AgentService({
    contextFactory: { async forRepositorySetup() { return context; } },
  });
  const loadedPlugin = {
    plugin: {
      id: "sample",
      hasAgentContribution() { return true; },
      integrateAgent(received) {
        assert.equal(received, context);
        return {
          install() { calls.push("install"); },
          remove() { calls.push("remove"); },
        };
      },
    },
  };

  const integration = await service.resolve(storeProject, loadedPlugin);
  assert.equal(integration instanceof AgentIntegration, true);
  assert.equal(integration.agentId, "codex");
  assert.equal(integration.pluginId, "sample");
  await service.install(storeProject, integration);
  await service.remove(storeProject, integration);
  assert.deepEqual(calls, ["install", "remove"]);
});

test("AgentService skips a Plugin without Agent contribution", async (t) => {
  const storeProject = await storeFixture(t);
  const service = new AgentService({
    contextFactory: { async forRepositorySetup() { throw new Error("unexpected context"); } },
  });
  const integration = await service.resolve(storeProject, {
    plugin: {
      id: "sample",
      hasAgentContribution() { return false; },
      integrateAgent() { throw new Error("unexpected integration"); },
    },
  });
  assert.equal(integration, null);
});
