/** @fileoverview User-level Agent gateway application contract. */

import assert from "node:assert/strict";
import test from "node:test";

import { AgentGatewayService } from "../internal/agent-gateway.js";
import { CandidateCli } from "../internal/cli.js";

test("AgentGatewayService owns explicit setup, status and removal without Project state", async () => {
  const calls = [];
  let installed = false;
  const adapter = Object.freeze({
    async invokeExtension(context, extension, request) {
      calls.push(["invoke", context.agent.id, extension.id, request]);
      if (request.operation === "status" && !installed) {
        throw new Error("AGENT_EXTENSION_STATUS_MISSING: orchestrator-agent");
      }
      if (request.operation === "connect") installed = true;
      if (request.operation === "remove") installed = false;
    },
    async preflight(context) { calls.push(["preflight", context.agent.id]); },
    async validateExtension(extension) { calls.push(["validate", extension.id]); },
  });
  const agentProvider = Object.freeze({
    adapter,
    catalog: Object.freeze({
      entries: Object.freeze([
        Object.freeze({ id: "claude", name: "Claude Code" }),
        Object.freeze({ id: "qwen", name: "Qwen Code" }),
      ]),
    }),
    resolve(id) {
      if (!this.catalog.entries.some((entry) => entry.id === id)) {
        throw new Error(`AGENT_NOT_DISCOVERED: ${id}`);
      }
      return Object.freeze({ id });
    },
  });
  const extensionProvider = Object.freeze({
    resolve(declaration) {
      assert.deepEqual(declaration, {
        id: "orchestrator-agent",
        source: "bundled:orchestrator-agent",
      });
      return Object.freeze({
        ...declaration,
        name: "OpenSpec Orchestrator Agent Gateway",
        root: "/distribution/extensions/orchestrator-agent",
      });
    },
  });
  const service = new AgentGatewayService({
    agentProvider,
    executor: async () => ({ failed: false, stderr: "", stdout: "" }),
    extensionId: "orchestrator-agent",
    extensionProvider,
    start: "/workspace",
  });

  assert.deepEqual(service.listAgents(), [
    { id: "claude", name: "Claude Code" },
    { id: "qwen", name: "Qwen Code" },
  ]);
  assert.deepEqual(await service.setup("qwen"), {
    agent_id: "qwen",
    extension_id: "orchestrator-agent",
    scope: "user",
    status: "ready",
  });
  assert.deepEqual(await service.status("qwen"), {
    agent_id: "qwen",
    extension_id: "orchestrator-agent",
    scope: "user",
    status: "ready",
  });
  assert.deepEqual(await service.remove("qwen"), {
    agent_id: "qwen",
    extension_id: "orchestrator-agent",
    scope: "user",
    status: "removed",
  });
  assert.deepEqual(calls, [
    ["preflight", "qwen"],
    ["validate", "orchestrator-agent"],
    ["invoke", "qwen", "orchestrator-agent", { operation: "status", scope: "user" }],
    ["invoke", "qwen", "orchestrator-agent", { operation: "connect", scope: "user" }],
    ["invoke", "qwen", "orchestrator-agent", { operation: "status", scope: "user" }],
    ["invoke", "qwen", "orchestrator-agent", { operation: "status", scope: "user" }],
    ["invoke", "qwen", "orchestrator-agent", { operation: "remove", scope: "user" }],
  ]);
});

test("CandidateCli exposes only the explicit user-level gateway lifecycle", async (t) => {
  const calls = [];
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  const result = (status) => ({
    agent_id: "qwen",
    extension_id: "orchestrator-agent",
    scope: "user",
    status,
  });
  const agentGatewayService = Object.freeze({
    listAgents() { return [{ id: "qwen", name: "Qwen Code" }]; },
    async setup(agentId) { calls.push(["setup", agentId]); return result("ready"); },
    async status(agentId) { calls.push(["status", agentId]); return result("ready"); },
    async remove(agentId) { calls.push(["remove", agentId]); return result("removed"); },
  });
  const progress = Object.freeze({
    fail() {},
    async run(_message, operation) { return operation(); },
    start() {},
    succeed() {},
    update() {},
    warn() {},
  });
  const program = new CandidateCli({ agentGatewayService, progress }).createProgram();

  await program.parseAsync(["node", "openspec-orch", "agent", "setup", "--agent", "qwen"]);
  await program.parseAsync(["node", "openspec-orch", "agent", "status", "--agent", "qwen"]);
  await program.parseAsync(["node", "openspec-orch", "agent", "remove", "--agent", "qwen"]);

  assert.deepEqual(calls, [["setup", "qwen"], ["status", "qwen"], ["remove", "qwen"]]);
  assert.equal(output.filter((line) => line === "Scope: user").length, 3);
  assert.equal(output.at(-1), "Status: removed");
  await assert.rejects(
    program.parseAsync(["node", "openspec-orch", "agent", "setup", "--agent", "unknown"]),
    (error) => error.code === "commander.invalidArgument",
  );
});
