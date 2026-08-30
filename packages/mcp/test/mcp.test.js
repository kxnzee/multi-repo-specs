/** @fileoverview Protocol and resource contract for the built-in Agent gateway. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { StoreResourceService } from "../lib/resources.js";
import { OrchestratorMcpApplication } from "../lib/application.js";
import {
  createOrchestratorMcpServer,
  ORCHESTRATOR_MCP_TOOLS,
} from "../lib/server.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("Package owns one exact MCP SDK without pretending to be a Project Plugin", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "@openspec-orch/mcp");
  assert.equal(manifest.dependencies["@modelcontextprotocol/sdk"], "1.30.0");
  assert.equal(manifest.dependencies["@openspec-orch/plugin-sdk"], undefined);
});

test("MCP exposes the exact governed surface and completes a real handshake", async (t) => {
  const calls = [];
  const resources = [{
    uri: "openspec-orch://store/specs/openspec/specs/payments/spec.md",
    name: "openspec/specs/payments/spec.md",
    mimeType: "text/markdown",
  }];
  const application = Object.freeze({
    getStatus(args) { calls.push(["get_status", args]); return { state: "ready" }; },
    getSetupContext() { return { strict_only: true }; },
    getChangeContext() { return { change_id: "pay" }; },
    getNextAction() { return { action: "record_result_receipt", actor: "agent" }; },
    getAssignmentScope() { return { assigned: true }; },
    getDoctorReport() { return { status: "ready" }; },
    queryGraph() { return { nodes: 1 }; },
    initializeProject(args) { calls.push(["initialize_project", args]); return { created: [] }; },
    connectProject() { calls.push(["connect_project"]); return { status: "ready" }; },
    listResources() { return resources; },
    readResource(uri) { return { ...resources[0], uri, text: "# Payments" }; },
  });
  const server = createOrchestratorMcpServer(new OrchestratorMcpApplication({ runtime: application }));
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map(({ name }) => name),
    ORCHESTRATOR_MCP_TOOLS.map(({ name }) => name),
  );
  assert.deepEqual(listed.tools.map(({ name }) => name), [
    "get_status",
    "get_setup_context",
    "get_change_context",
    "get_next_action",
    "get_assignment_scope",
    "get_doctor_report",
    "query_graph",
    "initialize_project",
    "connect_project",
  ]);
  assert.equal(
    listed.tools.some(({ name }) => /done|receipt|verify|release|archive|git|plugin/u.test(name)),
    false,
  );
  assert.equal(listed.tools.find(({ name }) => name === "get_status").annotations.readOnlyHint, true);
  assert.deepEqual(
    listed.tools.filter(({ name }) => ["initialize_project", "connect_project"].includes(name))
      .map(({ annotations }) => ({
        destructive: annotations.destructiveHint,
        idempotent: annotations.idempotentHint,
        readOnly: annotations.readOnlyHint,
      })),
    [
      { destructive: false, idempotent: true, readOnly: false },
      { destructive: false, idempotent: true, readOnly: false },
    ],
  );
  assert.equal(
    listed.tools.find(({ name }) => name === "connect_project").annotations.openWorldHint,
    true,
  );

  const status = await client.callTool({ name: "get_status", arguments: { change_id: "pay" } });
  assert.deepEqual(JSON.parse(status.content[0].text), { state: "ready" });
  assert.deepEqual(calls, [["get_status", { change_id: "pay" }]]);
  const next = await client.callTool({ name: "get_next_action", arguments: { change_id: "pay" } });
  assert.deepEqual(JSON.parse(next.content[0].text), {
    action: "record_result_receipt_via_cli",
    actor: "human",
    reason: "MCP не публикует Result Receipt; это человеческое действие остаётся в CLI",
  });
  const initialized = await client.callTool({
    name: "initialize_project",
    arguments: {
      store_id: "specs",
      agent_id: "qwen",
      repositories: [{
        repository_id: "frontend",
        remote: "ssh://git.example/frontend.git",
        default_branch: "main",
      }],
    },
  });
  assert.deepEqual(JSON.parse(initialized.content[0].text), { created: [] });
  assert.equal((await client.callTool({ name: "connect_project", arguments: {} })).isError, undefined);
  const invalid = await client.callTool({
    name: "get_change_context",
    arguments: { change_id: "pay", source: "human" },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /не принимает source/u);
  const unsafe = await client.callTool({
    name: "initialize_project",
    arguments: { store_id: "../specs", agent_id: "qwen" },
  });
  assert.equal(unsafe.isError, true);
  assert.match(unsafe.content[0].text, /lowercase kebab-case/u);
  assert.deepEqual((await client.listResources()).resources, resources);
  assert.equal((await client.readResource({ uri: resources[0].uri })).contents[0].text, "# Payments");
});

test("Store resources expose only normative allowlisted artifacts", async () => {
  const content = new Map([
    ["openspec-orch.yaml", "version: 2\n"],
    ["openspec/config.yaml", "schema: spec-driven\n"],
    ["openspec/context/03-architecture.md", "# Architecture\n"],
    ["openspec/specs/payments/spec.md", "# Payments\n"],
    ["openspec/changes/pay/intake.md", "# Intake\n"],
    ["openspec/changes/pay/proposal.md", "# Proposal\n"],
    ["openspec/changes/pay/notes.txt", "private notes\n"],
    ["tracking/cycles/pay/cycle.yaml", "contract_version: 1\n"],
  ]);
  const directories = new Set([
    "openspec/context",
    "openspec/specs",
    "openspec/specs/payments",
    "openspec/changes",
    "openspec/changes/pay",
    "tracking/cycles",
    "tracking/cycles/pay",
  ]);
  const files = Object.freeze({
    read: async (relativePath, { optional = false } = {}) => {
      if (content.has(relativePath)) return content.get(relativePath);
      if (optional) return null;
      throw new Error("ENOENT");
    },
    listFiles: async (directory) => [...content.keys()]
      .filter((relativePath) => path.posix.dirname(relativePath) === directory)
      .map((relativePath) => path.posix.basename(relativePath)),
    listDirectories: async (directory) => [...directories]
      .filter((candidate) => path.posix.dirname(candidate) === directory)
      .map((candidate) => path.posix.basename(candidate)),
  });
  const resourcesService = new StoreResourceService({ files, storeId: "specs" });
  const listed = await resourcesService.list();
  assert.deepEqual(listed.map(({ name }) => name), [
    "openspec-orch.yaml",
    "openspec/changes/pay/intake.md",
    "openspec/changes/pay/proposal.md",
    "openspec/config.yaml",
    "openspec/context/03-architecture.md",
    "openspec/specs/payments/spec.md",
    "tracking/cycles/pay/cycle.yaml",
  ]);
  assert.equal((await resourcesService.read(listed[5].uri)).text, "# Payments\n");
  await assert.rejects(
    resourcesService.read("openspec-orch://store/specs/openspec/changes/pay/notes.txt"),
    /MCP_RESOURCE_NOT_FOUND/u,
  );
  await assert.rejects(
    resourcesService.read("openspec-orch://store/specs/..%2Fsecrets.txt"),
    /MCP_RESOURCE_NOT_FOUND/u,
  );
});
