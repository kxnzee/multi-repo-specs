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
  assert.equal(manifest.dependencies.yaml, "2.9.0");
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
    getNextAction() { return { action: "apply_change", actor: "agent" }; },
    getAssignmentScope() { return { assigned: true }; },
    getDoctorReport() { return { status: "ready" }; },
    queryGraph() { return { nodes: 1 }; },
    initializeProject(args) { calls.push(["initialize_project", args]); return { created: [] }; },
    connectProject() { calls.push(["connect_project"]); return { status: "ready" }; },
    startAttempt(args) { calls.push(["start_attempt", args]); return { stored: "local" }; },
    completeAttempt(args) { calls.push(["complete_attempt", args]); return { stored: "change" }; },
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
    "start_attempt",
    "complete_attempt",
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

  const schemas = Object.fromEntries(listed.tools.map(({ name, inputSchema }) => (
    [name, inputSchema]
  )));
  const identifierSchema = {
    type: "string",
    minLength: 1,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  };
  const nonEmptyStringSchema = { type: "string", minLength: 1 };
  assert.deepEqual(schemas.get_status.properties.change_id, identifierSchema);
  assert.deepEqual(schemas.get_change_context.properties.artifact, identifierSchema);
  assert.deepEqual(schemas.start_attempt.properties, {
    change_id: identifierSchema,
    task_id: nonEmptyStringSchema,
  });
  assert.deepEqual(schemas.initialize_project.properties.store_id, identifierSchema);
  assert.deepEqual(
    schemas.initialize_project.properties.repositories.items.properties,
    {
      repository_id: identifierSchema,
      remote: nonEmptyStringSchema,
      default_branch: nonEmptyStringSchema,
    },
  );
  assert.deepEqual(schemas.query_graph.oneOf, [
    { properties: { query: { const: "report" } } },
    {
      properties: { query: { enum: ["node", "change_impact"] } },
      required: ["id"],
    },
  ]);
  assert.deepEqual(schemas.query_graph.properties.id, nonEmptyStringSchema);

  const status = await client.callTool({ name: "get_status", arguments: { change_id: "pay" } });
  assert.deepEqual(JSON.parse(status.content[0].text), { state: "ready" });
  assert.deepEqual(calls, [["get_status", { change_id: "pay" }]]);
  const next = await client.callTool({ name: "get_next_action", arguments: { change_id: "pay" } });
  assert.deepEqual(JSON.parse(next.content[0].text), {
    action: "apply_change",
    actor: "agent",
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
  const started = await client.callTool({
    name: "start_attempt",
    arguments: { change_id: "pay", task_id: "1" },
  });
  assert.deepEqual(JSON.parse(started.content[0].text), { stored: "local" });
  const completed = await client.callTool({
    name: "complete_attempt",
    arguments: { change_id: "pay", task_id: "1" },
  });
  assert.deepEqual(JSON.parse(completed.content[0].text), { stored: "change" });
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

test("Store resources follow each Change schema without mixing workflow artifacts", async () => {
  const content = new Map([
    ["openspec-orch.yaml", "version: 2\n"],
    ["openspec/config.yaml", "schema: spec-driven-extended\n"],
    ["openspec/schemas/spec-driven-extended/schema.yaml", `artifacts:
  - id: intake
    generates: intake.md
  - id: proposal
    generates: proposal.md
  - id: specs
    generates: specs/**/*.md
  - id: verify
    generates: verify.md
`],
    ["openspec/schemas/superspec-multirepo/schema.yaml", `artifacts:
  - id: brainstorm
    generates: brainstorm.md
  - id: proposal
    generates: proposal.md
  - id: specs
    generates: specs/**/*.md
  - id: plan
    generates: plan.md
  - id: verify
    generates: verify.md
  - id: finalize
    generates: finalize.md
`],
    ["openspec/context/03-architecture.md", "# Architecture\n"],
    ["openspec/specs/payments/spec.md", "# Payments\n"],
    ["openspec/changes/extended-pay/.openspec.yaml", "schema: spec-driven-extended\n"],
    ["openspec/changes/extended-pay/intake.md", "# Intake\n"],
    ["openspec/changes/extended-pay/proposal.md", "# Proposal\n"],
    ["openspec/changes/extended-pay/verify.md", "# Verify\n"],
    ["openspec/changes/extended-pay/plan.md", "# Wrong workflow\n"],
    ["openspec/changes/extended-pay/notes.txt", "private notes\n"],
    ["openspec/changes/super-pay/.openspec.yaml", "schema: superspec-multirepo\n"],
    ["openspec/changes/super-pay/brainstorm.md", "# Brainstorm\n"],
    ["openspec/changes/super-pay/proposal.md", "# Proposal\n"],
    ["openspec/changes/super-pay/specs/api/spec.md", "# API delta\n"],
    ["openspec/changes/super-pay/plan.md", "# Plan\n"],
    ["openspec/changes/super-pay/verify.md", "# Verify\n"],
    ["openspec/changes/super-pay/finalize.md", "# Finalize\n"],
    ["openspec/changes/super-pay/intake.md", "# Wrong workflow\n"],
  ]);
  const directories = new Set([
    "openspec/context",
    "openspec/schemas",
    "openspec/schemas/spec-driven-extended",
    "openspec/schemas/superspec-multirepo",
    "openspec/specs",
    "openspec/specs/payments",
    "openspec/changes",
    "openspec/changes/extended-pay",
    "openspec/changes/super-pay",
    "openspec/changes/super-pay/specs",
    "openspec/changes/super-pay/specs/api",
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
    "openspec/changes/extended-pay/intake.md",
    "openspec/changes/extended-pay/proposal.md",
    "openspec/changes/extended-pay/verify.md",
    "openspec/changes/super-pay/brainstorm.md",
    "openspec/changes/super-pay/finalize.md",
    "openspec/changes/super-pay/plan.md",
    "openspec/changes/super-pay/proposal.md",
    "openspec/changes/super-pay/specs/api/spec.md",
    "openspec/changes/super-pay/verify.md",
    "openspec/config.yaml",
    "openspec/context/03-architecture.md",
    "openspec/specs/payments/spec.md",
  ]);
  const masterSpec = listed.find(({ name }) => name === "openspec/specs/payments/spec.md");
  assert.equal((await resourcesService.read(masterSpec.uri)).text, "# Payments\n");
  await assert.rejects(
    resourcesService.read("openspec-orch://store/specs/openspec/changes/extended-pay/notes.txt"),
    /MCP_RESOURCE_NOT_FOUND/u,
  );
  assert.equal(listed.some(({ name }) => name.endsWith("/.openspec.yaml")), false);
  assert.equal(listed.some(({ name }) => name === "openspec/changes/extended-pay/plan.md"), false);
  assert.equal(listed.some(({ name }) => name === "openspec/changes/super-pay/intake.md"), false);
  await assert.rejects(
    resourcesService.read("openspec-orch://store/specs/..%2Fsecrets.txt"),
    /MCP_RESOURCE_NOT_FOUND/u,
  );
});

test("Store resources reject unsafe schema artifact paths", async () => {
  const content = new Map([
    ["openspec/config.yaml", "schema: unsafe\n"],
    ["openspec/schemas/unsafe/schema.yaml", `artifacts:
  - id: escape
    generates: ../secrets.md
`],
    ["openspec/changes/pay/.openspec.yaml", "schema: unsafe\n"],
  ]);
  const directories = new Set([
    "openspec/schemas",
    "openspec/schemas/unsafe",
    "openspec/changes",
    "openspec/changes/pay",
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

  await assert.rejects(
    new StoreResourceService({ files, storeId: "specs" }).list(),
    /generates небезопасен/u,
  );
});
