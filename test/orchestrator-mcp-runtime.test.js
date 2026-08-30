/** @fileoverview Distribution composition contract for the built-in Agent API. */

import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { OrchestratorMcpRuntime } from "../bin/internal/orchestrator-mcp-runtime.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const serverPath = path.join(repositoryRoot, "bin", "openspec-orch-mcp.js");

test("public MCP executable completes stdio handshake and calls Core Doctor", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "distribution-smoke", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.some(({ name }) => name === "get_doctor_report"), true);
  assert.equal(tools.tools.some(({ name }) => name === "record_result_receipt"), false);
  const response = await client.callTool({ name: "get_doctor_report", arguments: {} });
  const report = JSON.parse(response.content[0].text);
  assert.equal(report.version, 1);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks[0].id, "store");
});

test("runtime rereads Project state and exposes OpenSpec context without optional Plugins", async () => {
  let resolutions = 0;
  const project = Object.freeze({
    strict: true,
    template: Object.freeze({ id: "base" }),
    agent: Object.freeze({ id: "qwen" }),
    extensions: Object.freeze(["orchestrator-agent"]),
    plugins: Object.freeze([]),
    repositories: Object.freeze([Object.freeze({
      id: "specs",
      role: "store",
      plugins: Object.freeze([]),
    })]),
    storeRepository: Object.freeze({ hasPlugin: () => false }),
    pluginDeclaration: () => undefined,
    requireRepository: () => Object.freeze({ id: "specs", role: "store" }),
  });
  const storeProject = Object.freeze({
    store: Object.freeze({ id: "specs" }),
    checkout: Object.freeze({}),
    project,
  });
  const openSpecCalls = [];
  const runtime = new OrchestratorMcpRuntime({
    start: "/workspace/specs",
    storeProjectService: Object.freeze({
      async resolve() {
        resolutions += 1;
        return storeProject;
      },
    }),
    currentRepositoryService: Object.freeze({
      resolve: async () => ({ id: "specs", role: "store", path: "/workspace/specs" }),
    }),
    managerService: Object.freeze({ forStore: () => ({}) }),
    openSpecService: Object.freeze({
      forRepository: () => Object.freeze({
        async listChanges() {
          openSpecCalls.push("list");
          return { changes: [{ name: "pay" }] };
        },
        async changeStatus(changeId) {
          openSpecCalls.push(["status", changeId]);
          return { changeName: changeId, schemaName: "base-v1" };
        },
        async artifactInstructions(changeId, artifact) {
          openSpecCalls.push(["instructions", changeId, artifact]);
          return { instruction: "Use exact schema" };
        },
        async nextAction(changeId) {
          openSpecCalls.push(["next-action", changeId]);
          return { action: "prepare_artifact", actor: "agent", artifact: "design" };
        },
      }),
    }),
    fileService: Object.freeze({
      forRepository: () => Object.freeze({
        read: async () => null,
        listFiles: async () => [],
        listDirectories: async () => [],
      }),
    }),
    gitService: Object.freeze({
      forRepository: () => Object.freeze({ revision: async () => "a".repeat(40) }),
    }),
    doctorService: Object.freeze({
      inspect: async () => ({ toJSON: () => ({ version: 1, status: "ready" }) }),
    }),
    setupService: Object.freeze({
      inspect: () => ({ default_template_id: "base" }),
      initialize: async (input) => ({ store_id: input.storeId }),
      connect: async () => ({ status: "ready" }),
    }),
  });

  const status = await runtime.getStatus();
  const context = await runtime.getChangeContext({ change_id: "pay", artifact: "design" });
  const next = await runtime.getNextAction({ change_id: "pay" });
  const assignment = await runtime.getAssignmentScope({ change_id: "pay" });
  const setup = await runtime.getSetupContext();
  const initialized = await runtime.initializeProject({ store_id: "specs", agent_id: "qwen" });
  const connected = await runtime.connectProject();
  assert.equal(resolutions, 4);
  assert.equal(status.capabilities.tracking.available, false);
  assert.equal(status.capabilities.graph.available, false);
  assert.deepEqual(context.openspec_status, { changeName: "pay", schemaName: "base-v1" });
  assert.deepEqual(context.artifact_instructions, { instruction: "Use exact schema" });
  assert.deepEqual(next, { action: "prepare_artifact", actor: "agent", artifact: "design" });
  assert.equal(assignment.current_assignment.revision, "a".repeat(40));
  assert.equal(setup.constraints.strict_only, true);
  assert.equal(initialized.store_id, "specs");
  assert.equal(connected.status, "ready");
  assert.deepEqual(openSpecCalls, [
    "list",
    ["status", "pay"],
    ["instructions", "pay", "design"],
    ["next-action", "pay"],
  ]);
});
