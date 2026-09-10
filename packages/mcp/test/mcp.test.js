/** @fileoverview Контракт протокола и ресурсов встроенного Agent gateway. */

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
    agentTools: Object.freeze([Object.freeze({
      name: "optional_read",
      description: "Read one optional Plugin capability.",
      inputSchema: Object.freeze({
        type: "object",
        properties: Object.freeze({
          id: Object.freeze({ type: "string", minLength: 1 }),
          count: Object.freeze({ type: "integer", minimum: 1 }),
          filter: Object.freeze({ type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false }),
        }),
        required: Object.freeze(["id"]),
        additionalProperties: false,
      }),
      annotations: Object.freeze({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      }),
    })]),
    getStatus(args) { calls.push(["get_status", args]); return { state: "ready" }; },
    getSetupContext() { return { fixed_cwd: true }; },
    getChangeContext() { return { change_id: "pay" }; },
    getNextAction() { return { action: "apply_change", actor: "agent" }; },
    getAssignmentScope() { return { assigned: true }; },
    getDoctorReport() { return { status: "ready" }; },
    invokeAgentTool(name, args) {
      calls.push([name, args]);
      return { plugin: name, id: args.id };
    },
    initializeProject(args) {
      if (args.store_id === "orchestrator") {
        throw new Error(
          "INIT_TARGET_INVALID: Store target пересекается с Project Template. " +
            "Не запускайте openspec-orch init для checkout Orchestrator",
        );
      }
      calls.push(["initialize_project", args]);
      return { created: [] };
    },
    connectProject() { calls.push(["connect_project"]); return { status: "ready" }; },
    recordImplementation(args) { calls.push(["record_implementation", args]); return { stored: "change" }; },
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
    listed.tools.map(({ name }) => name).filter((name) => name !== "optional_read"),
    ORCHESTRATOR_MCP_TOOLS.map(({ name }) => name),
  );
  assert.deepEqual(listed.tools.map(({ name }) => name), [
    "get_status",
    "get_setup_context",
    "get_change_context",
    "get_next_action",
    "get_assignment_scope",
    "get_doctor_report",
    "optional_read",
    "initialize_project",
    "connect_project",
    "start_attempt",
    "complete_attempt",
    "record_implementation",
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
  assert.match(
    listed.tools.find(({ name }) => name === "initialize_project").description,
    /отдельный центральный Store/u,
  );
  assert.match(
    listed.tools.find(({ name }) => name === "initialize_project").description,
    /Нельзя выбирать рабочую копию Orchestrator, Template или Code Repository/u,
  );
  assert.match(
    listed.tools.find(({ name }) => name === "initialize_project")
      .inputSchema.properties.repositories.description,
    /Только необязательные Code Repository.*Не включайте центральный Store/u,
  );

  const schemas = Object.fromEntries(listed.tools.map(({ name, inputSchema }) => (
    [name, inputSchema]
  )));
  const shape = (schema) => JSON.parse(JSON.stringify(schema, (key, value) =>
    key === "description" ? undefined : value));
  const identifierSchema = {
    type: "string",
    minLength: 1,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  };
  const nonEmptyStringSchema = { type: "string", minLength: 1 };
  assert.deepEqual(shape(schemas.get_status.properties.change_id), identifierSchema);
  assert.deepEqual(shape(schemas.get_change_context.properties.artifact), identifierSchema);
  assert.deepEqual(shape(schemas.get_change_context.properties.include_assignment), { type: "boolean" });
  for (const name of [
    "get_status",
    "get_setup_context",
    "get_change_context",
    "get_next_action",
    "get_assignment_scope",
    "get_doctor_report",
    "optional_read",
  ]) {
    assert.deepEqual(shape(schemas[name].properties.if_context_revision), nonEmptyStringSchema, name);
  }
  assert.equal(schemas.initialize_project.properties.if_context_revision, undefined);
  for (const name of ["start_attempt", "complete_attempt"]) {
    const { description, ...taskSchema } = schemas[name].properties.task_id;
    assert.match(description, /artifact_instructions.tasks/u);
    assert.match(description, /не используйте номер задачи/u);
    assert.deepEqual(shape({ ...schemas[name].properties, task_id: taskSchema }), {
      change_id: identifierSchema,
      task_id: nonEmptyStringSchema,
    });
  }
  assert.deepEqual(shape(schemas.initialize_project.properties.store_id), identifierSchema);
  assert.deepEqual(
    shape(schemas.initialize_project.properties.repositories.items.properties),
    {
      repository_id: identifierSchema,
      remote: nonEmptyStringSchema,
      default_branch: nonEmptyStringSchema,
    },
  );
  assert.deepEqual(schemas.optional_read.properties.id, nonEmptyStringSchema);

  const status = await client.callTool({ name: "get_status", arguments: { change_id: "pay" } });
  const statusValue = JSON.parse(status.content[0].text);
  assert.equal(statusValue.state, "ready");
  assert.match(statusValue.context_revision, /^[a-f0-9]{64}$/u);
  assert.equal(status.content[0].text.includes("\n"), false);
  assert.deepEqual(calls, [["get_status", { change_id: "pay" }]]);
  const unchangedStatus = await client.callTool({
    name: "get_status",
    arguments: { change_id: "pay", if_context_revision: statusValue.context_revision },
  });
  assert.deepEqual(JSON.parse(unchangedStatus.content[0].text), {
    unchanged: true,
    context_revision: statusValue.context_revision,
  });
  assert.deepEqual(calls, [
    ["get_status", { change_id: "pay" }],
    ["get_status", { change_id: "pay" }],
  ]);
  const next = await client.callTool({ name: "get_next_action", arguments: { change_id: "pay" } });
  const nextValue = JSON.parse(next.content[0].text);
  assert.equal(nextValue.action, "apply_change");
  assert.equal(nextValue.actor, "agent");
  assert.match(nextValue.context_revision, /^[a-f0-9]{64}$/u);
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
  const wrongTarget = await client.callTool({
    name: "initialize_project",
    arguments: { store_id: "orchestrator", agent_id: "qwen" },
  });
  assert.equal(wrongTarget.isError, true);
  assert.match(wrongTarget.content[0].text, /INIT_TARGET_INVALID/u);
  assert.match(wrongTarget.content[0].text, /checkout Orchestrator/u);
  const invalidChangeId = await client.callTool({
    name: "get_status",
    arguments: { change_id: "PAY_1" },
  });
  assert.equal(invalidChangeId.isError, true);
  assert.match(invalidChangeId.content[0].text, /change_id.*lowercase kebab-case/u);
  const invalidArtifact = await client.callTool({
    name: "get_change_context",
    arguments: { change_id: "pay", artifact: "VERIFY_DOC" },
  });
  assert.equal(invalidArtifact.isError, true);
  assert.match(invalidArtifact.content[0].text, /artifact.*lowercase kebab-case/u);
  const invalidAssignmentFlag = await client.callTool({
    name: "get_change_context",
    arguments: { change_id: "pay", include_assignment: "yes" },
  });
  assert.equal(invalidAssignmentFlag.isError, true);
  assert.match(invalidAssignmentFlag.content[0].text, /include_assignment.*boolean/u);
  const duplicateRepository = await client.callTool({
    name: "initialize_project",
    arguments: {
      store_id: "specs",
      agent_id: "qwen",
      repositories: [
        { repository_id: "frontend", remote: "ssh://one", default_branch: "main" },
        { repository_id: "frontend", remote: "ssh://two", default_branch: "main" },
      ],
    },
  });
  assert.equal(duplicateRepository.isError, true);
  assert.match(duplicateRepository.content[0].text, /повторяющийся repository_id frontend/u);
  const storeIncludedAsCode = await client.callTool({
    name: "initialize_project",
    arguments: {
      store_id: "specs",
      agent_id: "qwen",
      repositories: [
        { repository_id: "specs", remote: "ssh://specs", default_branch: "main" },
      ],
    },
  });
  assert.equal(storeIncludedAsCode.isError, true);
  assert.match(storeIncludedAsCode.content[0].text, /STORE_INCLUDED_AS_CODE/u);
  assert.match(
    storeIncludedAsCode.content[0].text,
    /Store уже задан через store_id.*удалите specs из repositories.*не меняйте store_id/u,
  );
  for (const extra of [{ count: "2" }, { count: 0 }, { filter: {} }, { filter: { enabled: "yes" } }]) {
    const before = calls.length;
    const rejected = await client.callTool({ name: "optional_read", arguments: { id: "sample", ...extra } });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /MCP_TOOL_INPUT_INVALID/);
    assert.equal(calls.length, before);
  }
  const handoff = { change_id: "pay", task_id: "1", task_description: "Implement",
    pull_request: "https://example.test/pr/42", commits: [], summary: "Draft",
    remaining: "Implementation", expected_version: 0 };
  for (const extra of [{ expected_version: "0" }, { expected_version: -1 },
    { commits: ["HEAD"] }, { task_description: "" }, { extra: true }]) {
    const before = calls.length;
    const rejected = await client.callTool({ name: "record_implementation", arguments: { ...handoff, ...extra } });
    assert.equal(rejected.isError, true);
    assert.equal(calls.length, before, "invalid input must not reach the handler");
  }
  const pluginRead = await client.callTool({
    name: "optional_read",
    arguments: { id: "sample" },
  });
  const pluginValue = JSON.parse(pluginRead.content[0].text);
  assert.equal(pluginValue.plugin, "optional_read");
  assert.equal(pluginValue.id, "sample");
  assert.match(pluginValue.context_revision, /^[a-f0-9]{64}$/u);
  assert.deepEqual((await client.listResources()).resources, resources);
  assert.equal((await client.readResource({ uri: resources[0].uri })).contents[0].text, "# Payments");
});

test("every advertised MCP tool dispatches to its matching application method", async (t) => {
  const dispatch = [
    ["get_status", "getStatus", {}],
    ["get_setup_context", "getSetupContext", {}],
    ["get_change_context", "getChangeContext", { change_id: "pay" }],
    ["get_next_action", "getNextAction", {}],
    ["get_assignment_scope", "getAssignmentScope", {}],
    ["get_doctor_report", "getDoctorReport", {}],
    ["initialize_project", "initializeProject", { store_id: "specs", agent_id: "qwen" }],
    ["connect_project", "connectProject", {}],
    ["start_attempt", "startAttempt", { change_id: "pay", task_id: "1" }],
    ["complete_attempt", "completeAttempt", { change_id: "pay", task_id: "1" }],
    ["record_implementation", "recordImplementation", { change_id: "pay", task_id: "1",
      task_description: "Implement", pull_request: "https://example.test/pr/1", commits: [],
      summary: "Draft", remaining: "", expected_version: 0 }],
  ];
  const calls = [];
  const application = {
    agentTools: [],
    invokeAgentTool() {},
    listResources() { return []; },
    readResource() { return null; },
  };
  for (const [, method] of dispatch) {
    application[method] = (args) => {
      calls.push([method, args]);
      return { method };
    };
  }
  const server = createOrchestratorMcpServer(Object.freeze(application));
  const client = new Client({ name: "dispatch-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  for (const [name, method, args] of dispatch) {
    const result = await client.callTool({ name, arguments: args });
    const value = JSON.parse(result.content[0].text);
    assert.equal(value.method, method);
    if (name.startsWith("get_")) assert.match(value.context_revision, /^[a-f0-9]{64}$/u);
    else assert.equal(value.context_revision, undefined);
  }
  assert.deepEqual(
    calls,
    dispatch.map(([, method, args]) => [method, args]),
  );
  const unknown = await client.callTool({ name: "toString", arguments: {} });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /MCP_TOOL_NOT_FOUND: toString/u);
});

test("Store resources follow each Change schema without mixing workflow artifacts", async () => {
  const content = new Map([
    ["openspec-orch.yaml", "version: 1\n"],
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
  content.set("openspec/changes/broken/.openspec.yaml", "schema: []\n");
  directories.add("openspec/changes/broken");
  const scoped = await resourcesService.list({ changeId: "extended-pay" });
  assert.ok(scoped.some(({ name }) => name.endsWith("extended-pay/proposal.md")));
  assert.equal((await resourcesService.read("openspec-orch://store/specs/openspec/changes/extended-pay/proposal.md")).text, "# Proposal\n");
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
  content.set("openspec/schemas/unsafe/schema.yaml", "artifacts: [null]\n");
  await assert.rejects(new StoreResourceService({ files, storeId: "specs" }).list(), /MCP_RESOURCE_SCHEMA_INVALID/);
});

test("reading one static resource does not enumerate or read unrelated files", async () => {
  const calls = [];
  const service = new StoreResourceService({ storeId: "specs", files: {
    async read(name) { calls.push(name); return "# Spec"; },
    async listFiles() { throw new Error("unexpected enumeration"); },
    async listDirectories() { throw new Error("unexpected enumeration"); },
  } });
  for (const uri of ["openspec-orch://store/other/openspec/specs/pay/spec.md",
    "openspec-orch://store/specs/openspec/changes/archive/proposal.md",
    "openspec-orch://store/specs/openspec/specs/../private/spec.md"]) {
    await assert.rejects(service.read(uri), /MCP_RESOURCE_NOT_FOUND/u);
  }
  const result = await service.read("openspec-orch://store/specs/openspec/specs/pay/spec.md");
  assert.equal(result.text, "# Spec");
  assert.deepEqual(calls, ["openspec/specs/pay/spec.md"]);
});
