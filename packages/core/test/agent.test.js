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
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), `version: 1
strict: true
agents: [qwen]
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
  const context = Object.freeze({ agent: Object.freeze({ id: "qwen" }) });
  const service = new AgentService({
    contextFactory: { async forStoreSetup() { return context; } },
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
  assert.equal(integration.agentId, "qwen");
  assert.equal(integration.pluginId, "sample");
  await service.install(storeProject, integration);
  await service.remove(storeProject, integration);
  assert.deepEqual(calls, ["install", "remove"]);
});

test("AgentService skips a Plugin without Agent contribution", async (t) => {
  const storeProject = await storeFixture(t);
  const service = new AgentService({
    contextFactory: { async forStoreSetup() { throw new Error("unexpected context"); } },
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

test("AgentService copies Plugin template into Store and only reports manual cleanup paths", async (t) => {
  const storeProject = await storeFixture(t);
  const pluginRoot = path.join(storeProject.root, ".openspec-orch/plugins/sample");
  const templateRoot = path.join(pluginRoot, "template");
  const skillSource = path.join(templateRoot, "skills/sample/SKILL.md");
  const graphSource = path.join(pluginRoot, "template/openspec/graph.yaml");
  await fs.mkdir(path.dirname(skillSource), { recursive: true });
  await fs.mkdir(path.dirname(graphSource), { recursive: true });
  await fs.writeFile(skillSource, "plugin skill\n");
  await fs.writeFile(graphSource, "version: 1\n");
  await fs.writeFile(path.join(templateRoot, "template.yaml"), `agents:
  qwen:
    copy:
      - from: openspec/graph.yaml
        to: openspec/graph.yaml
      - from: skills
        to: .agents/skills
`);
  const service = new AgentService({
    contextFactory: { async forStoreSetup() { throw new Error("unexpected context"); } },
  });
  const loadedPlugin = {
    root: pluginRoot,
    plugin: {
      id: "sample",
      hasAgentContribution() { return false; },
      integrateAgent() { throw new Error("unexpected integration"); },
    },
  };
  const target = path.join(storeProject.root, ".agents/skills/sample/SKILL.md");
  const graphTarget = path.join(storeProject.root, "openspec/graph.yaml");

  const integration = await service.resolve(storeProject, loadedPlugin);
  await service.install(storeProject, integration);
  await service.install(storeProject, integration);
  assert.equal(await fs.readFile(target, "utf8"), "plugin skill\n");
  assert.equal(await fs.readFile(graphTarget, "utf8"), "version: 1\n");

  await fs.writeFile(skillSource, "updated plugin skill\n");
  const updatedIntegration = await service.resolve(storeProject, loadedPlugin);
  await assert.rejects(
    service.install(storeProject, updatedIntegration),
    /существующий файл с другим содержимым/u,
  );
  assert.equal(await fs.readFile(target, "utf8"), "plugin skill\n");

  const cleanup = await service.remove(storeProject, integration);
  assert.deepEqual(cleanup.cleanupPaths, [
    ".agents/skills/sample/SKILL.md",
    "openspec/graph.yaml",
  ]);
  assert.equal(await fs.readFile(target, "utf8"), "plugin skill\n");
  assert.equal(await fs.readFile(graphTarget, "utf8"), "version: 1\n");
});

test("explicit declarative Agent API replaces automatic Plugin Template", async (t) => {
  const storeProject = await storeFixture(t);
  const pluginRoot = path.join(storeProject.root, ".openspec-orch/plugins/sample");
  await fs.mkdir(path.join(pluginRoot, "template"), { recursive: true });
  await fs.mkdir(path.join(pluginRoot, "assets"));
  await fs.writeFile(path.join(pluginRoot, "template/ignored.txt"), "default\n");
  await fs.writeFile(path.join(pluginRoot, "assets/selected.txt"), "explicit\n");
  const context = Object.freeze({ agent: Object.freeze({ id: "qwen" }) });
  const service = new AgentService({
    contextFactory: { async forStoreSetup() { return context; } },
  });
  const integration = await service.resolve(storeProject, {
    root: pluginRoot,
    plugin: {
      id: "sample",
      hasAgentContribution() { return true; },
      integrateAgent() {
        return { copy: [{ from: "assets/selected.txt", to: "selected.txt" }] };
      },
    },
  });

  await service.install(storeProject, integration);
  assert.equal(await fs.readFile(path.join(storeProject.root, "selected.txt"), "utf8"), "explicit\n");
  await assert.rejects(fs.access(path.join(storeProject.root, "ignored.txt")), { code: "ENOENT" });
  assert.deepEqual((await service.remove(storeProject, integration)).cleanupPaths, ["selected.txt"]);
});
