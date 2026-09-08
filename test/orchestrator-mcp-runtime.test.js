/** @fileoverview Distribution composition contract for the built-in Agent API. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execa } from "execa";
import {
  configuration, createProject, createRepository, createRepositoryCheckout, PackageSupplyService,
} from "@openspec-orch/core";

import { OrchestratorMcpRuntime } from "../bin/internal/orchestrator-mcp-runtime.js";
import { openSpecGraphAgentContribution } from "../plugins/openspec-graph/lib/agent.js";
import { createPluginMaterializer } from "../packages/core/test/helpers/plugin-materializer.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const serverPath = path.join(repositoryRoot, "bin", "openspec-orch-mcp.js");
const graphContributions = Object.freeze([Object.freeze({
  pluginId: "openspec-graph",
  contribution: openSpecGraphAgentContribution,
})]);

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
  const graphTool = tools.tools.find(({ name }) => name === "query_graph");
  assert.deepEqual(graphTool.inputSchema.oneOf, [
    { properties: { query: { const: "report" } } },
    {
      properties: { query: { enum: ["node", "change_impact"] } },
      required: ["id"],
    },
  ]);
  assert.equal(tools.tools.some(({ name }) => name === "record_result_receipt"), false);
  assert.equal(tools.tools.some(({ name }) => name === "start_attempt"), true);
  assert.equal(tools.tools.some(({ name }) => name === "complete_attempt"), true);
  const response = await client.callTool({ name: "get_doctor_report", arguments: {} });
  const report = JSON.parse(response.content[0].text);
  assert.equal(report.version, 1);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks[0].id, "store");
});

test("public MCP calls an external Agent-only Plugin and still serves Core status", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-mcp-plugin-")));
  const sourceRoot = path.join(root, "external-agent-plugin");
  const client = new Client({ name: "external-plugin-smoke", version: "1.0.0" });
  t.after(async () => {
    // Windows keeps the server's working directory locked until the process exits.
    try {
      await client.close();
    } finally {
      await fs.rm(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  await execa("git", ["init", "--initial-branch", "main", root]);
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  await fs.mkdir(sourceRoot);
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), configuration.serializeProject(createProject({
    version: 1,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: ["external-agent"],
    repositories: [{
      id: "specs",
      role: "store",
      remote: "https://example.test/specs.git",
      defaultBranch: "main",
      plugins: [],
    }],
  })));
  await fs.writeFile(path.join(sourceRoot, "package.json"), `${JSON.stringify({
    name: "@test/openspec-orch-plugin-external-agent",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(sourceRoot, "index.js"), `
import { definePlugin } from "@openspec-orch/plugin-sdk";
export default definePlugin({
  id: "external-agent",
  agent: {
    create: (context) => Object.freeze({
      repository: context.repository,
      invocation: context.invocation,
    }),
    tools: [{
      name: "external_probe",
      description: "Read external Plugin state.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: (application) => ({ source: "external", ...application }),
    }],
  },
});
`);
  const checkout = createRepositoryCheckout(createRepository({
    id: "specs", role: "store", remote: "https://example.test/specs.git",
    defaultBranch: "main", plugins: [],
  }), root);
  await new PackageSupplyService({ installer: createPluginMaterializer({ sourceRoot }) })
    .forStore(checkout).install({
      id: "external-agent", kind: "plugins", source: sourceRoot, validate: async () => true,
    });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    env: { ...process.env },
    stderr: "pipe",
  });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.equal(tools.tools.some(({ name }) => name === "external_probe"), true);
  const response = await client.callTool({ name: "external_probe", arguments: {} });
  assert.notEqual(response.isError, true, JSON.stringify(response.content));
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.source, "external");
  assert.deepEqual(result.repository, { id: "specs", role: "store" });
  assert.equal(result.invocation.id, "specs");
  const status = await client.callTool({ name: "get_status", arguments: {} });
  assert.notEqual(status.isError, true, JSON.stringify(status.content));
  assert.equal(JSON.parse(status.content[0].text).store_id, "specs");
});

test("runtime rereads Project state and exposes OpenSpec context without optional Plugins", async () => {
  let resolutions = 0;
  const storeRepository = Object.freeze({
    id: "specs",
    role: "store",
    plugins: Object.freeze([]),
    hasPlugin: () => false,
  });
  const codeRepository = Object.freeze({
    id: "frontend",
    role: "code",
    description: "Личный кабинет: React, TypeScript.",
    plugins: Object.freeze([]),
  });
  const project = Object.freeze({
    strict: true,
    template: Object.freeze({ id: "default" }),
    agent: Object.freeze({ id: "qwen" }),
    extensions: Object.freeze(["orchestrator-agent"]),
    plugins: Object.freeze([]),
    repositories: Object.freeze([storeRepository, codeRepository]),
    storeRepository,
    pluginDeclaration: () => undefined,
    requireRepository: (repositoryId) => (
      [storeRepository, codeRepository].find(({ id }) => id === repositoryId)
    ),
  });
  const storeProject = Object.freeze({
    store: Object.freeze({ id: "specs" }),
    checkout: Object.freeze({}),
    root: "/workspace/specs",
    project,
  });
  const openSpecCalls = [];
  const runtime = new OrchestratorMcpRuntime({
    agentContributions: graphContributions,
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
          return { changeName: changeId, schemaName: "spec-driven-extended" };
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
    repositoryStatusService: Object.freeze({
      async inspect(options) {
        assert.deepEqual(options, {
          start: "/workspace/specs",
          repositoryIds: ["frontend"],
        });
        return [Object.freeze({
          id: "frontend",
          role: "code",
          path: "/workspace/src/frontend",
          connected: true,
          clean: true,
          state: "connected",
        })];
      },
    }),
    doctorService: Object.freeze({
      inspect: async () => ({ toJSON: () => ({ version: 1, status: "ready" }) }),
    }),
    setupService: Object.freeze({
      inspect: () => ({ default_template_id: "default" }),
      initialize: async (input) => ({ store_id: input.storeId }),
      connect: async () => ({ status: "ready" }),
    }),
  });

  const status = await runtime.getStatus();
  const context = await runtime.getChangeContext({
    change_id: "pay",
    artifact: "design",
    include_assignment: true,
  });
  const next = await runtime.getNextAction({ change_id: "pay" });
  const assignment = await runtime.getAssignmentScope({ change_id: "pay" });
  const setup = await runtime.getSetupContext();
  const initialized = await runtime.initializeProject({ store_id: "specs", agent_id: "qwen" });
  const connected = await runtime.connectProject();
  for (const result of [status, context]) {
    assert.equal(result.project.repositories[1].description, codeRepository.description);
    assert.equal(Object.hasOwn(result.project.repositories[0], "description"), false);
  }
  assert.equal(resolutions, 4);
  assert.equal(status.capabilities.tracking.available, false);
  assert.equal(status.capabilities.graph.available, false);
  assert.deepEqual(context.openspec_status, { changeName: "pay", schemaName: "spec-driven-extended" });
  assert.deepEqual(context.artifact_instructions, { instruction: "Use exact schema" });
  assert.deepEqual(context.assignment_scope, {
    assigned: null,
    assignments: [{
      repository_id: "frontend",
      assigned: null,
      checkout: "/workspace/src/frontend",
      revision: "a".repeat(40),
      connected: true,
      clean: true,
      state: "connected",
    }],
    current_assignment: {
      repository_id: "specs",
      role: "store",
      path: "/workspace/specs",
      revision: "a".repeat(40),
    },
  });
  assert.deepEqual(next, { action: "prepare_artifact", actor: "agent", artifact: "design" });
  assert.equal(assignment.current_assignment.revision, "a".repeat(40));
  assert.equal(assignment.assigned, null);
  assert.deepEqual(assignment.assignments, [{
    repository_id: "frontend",
    assigned: null,
    checkout: "/workspace/src/frontend",
    revision: "a".repeat(40),
    connected: true,
    clean: true,
    state: "connected",
  }]);
  assert.deepEqual(setup.constraints, {
    fixed_cwd: true,
    strict_only: true,
    arbitrary_workspace: false,
    disconnect_exposed: false,
    target_role: "store",
    separate_git_repository: true,
    forbidden_targets: [
      "orchestrator_checkout",
      "template_source",
      "code_repository",
    ],
  });
  assert.equal(initialized.store_id, "specs");
  assert.equal(connected.status, "ready");
  assert.deepEqual(openSpecCalls, [
    "list",
    ["status", "pay"],
    ["instructions", "pay", "design"],
    ["next-action", "pay"],
  ]);
});

test("runtime does not advertise a bound Graph Plugin whose runtime is unavailable", async () => {
  let resolutionError = Object.assign(new Error("PLUGIN_RUNTIME_UNAVAILABLE"), {
    code: "PLUGIN_RUNTIME_UNAVAILABLE",
  });
  const project = Object.freeze({
    strict: true,
    template: Object.freeze({ id: "default" }),
    agent: Object.freeze({ id: "qwen" }),
    extensions: Object.freeze([]),
    plugins: Object.freeze(["openspec-graph"]),
    repositories: Object.freeze([]),
    storeRepository: Object.freeze({ hasPlugin: (pluginId) => pluginId === "openspec-graph" }),
    pluginDeclaration: (pluginId) => pluginId === "openspec-graph"
      ? Object.freeze({ id: pluginId, source: "bundled:openspec-graph" })
      : undefined,
  });
  const runtime = new OrchestratorMcpRuntime({
    agentContributions: graphContributions,
    start: "/workspace/specs",
    storeProjectService: Object.freeze({
      resolve: async () => Object.freeze({
        store: Object.freeze({ id: "specs" }),
        checkout: Object.freeze({}),
        project,
      }),
    }),
    currentRepositoryService: Object.freeze({ resolve: async () => null }),
    managerService: Object.freeze({
      forStore: () => Object.freeze({
        async resolve() { throw resolutionError; },
      }),
    }),
    openSpecService: Object.freeze({
      forRepository: () => Object.freeze({ listChanges: async () => ({ changes: [] }) }),
    }),
    doctorService: Object.freeze({
      inspect: async () => ({ toJSON: () => ({ version: 1, status: "blocked" }) }),
    }),
    setupService: Object.freeze({
      inspect: () => ({}),
      initialize: async () => ({}),
      connect: async () => ({}),
    }),
  });

  const status = await runtime.getStatus();
  assert.deepEqual(status.capabilities.graph, {
    provider: "openspec-graph",
    available: false,
    reason: "Plugin is not connected or unavailable; inspect Doctor",
  });
  await assert.rejects(
    runtime.invokeAgentTool("query_graph", { query: "report" }),
    /not connected or unavailable/u,
  );

  resolutionError = new TypeError("broken Plugin factory");
  await assert.rejects(runtime.getStatus(), /broken Plugin factory/u);
});

test("public MCP refreshes artifact content and exposes only the declared shared policies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-mcp-freshness-"));
  const client = new Client({ name: "freshness-regression", version: "1.0.0" });
  t.after(async () => {
    try { await client.close(); } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  await execa("git", ["init", "--initial-branch", "main"], { cwd: root });
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.writeFile(path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n");
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), configuration.serializeProject(createProject({
    version: 1, strict: true, template: { id: "default" }, agent: { id: "qwen" },
    extensions: [], plugins: [], repositories: [{
      id: "specs", role: "store", remote: "https://example.test/specs.git",
      defaultBranch: "main", plugins: [],
    }],
  })));
  await fs.cp(path.join(repositoryRoot, "templates/default/openspec"), path.join(root, "openspec"), { recursive: true });
  await fs.mkdir(path.join(root, "openspec/process"));
  await fs.mkdir(path.join(root, "openspec/context"));
  await fs.mkdir(path.join(root, "openspec/specs/payments"), { recursive: true });
  const shared = ["STORE.md", "openspec/process/quality-gates.md", "openspec/process/release-process.md",
    "openspec/context/product.md", "openspec/specs/payments/spec.md"];
  for (const name of shared) await fs.writeFile(path.join(root, name), "# Original\n");
  await fs.writeFile(path.join(root, "openspec/process/private.md"), "private\n");
  for (const change of ["pay", "other"]) {
    await execa("openspec", ["new", "change", change, "--schema", "spec-driven-extended"], { cwd: root });
    await fs.writeFile(path.join(root, `openspec/changes/${change}/intake.md`), "# Intake\n");
    await fs.writeFile(path.join(root, `openspec/changes/${change}/proposal.md`), "## Why\nOriginal.\n");
  }
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [serverPath], cwd: root, env: { ...process.env }, stderr: "pipe",
  }));
  const readContext = async (revision) => {
    const response = await client.callTool({ name: "get_change_context", arguments: {
      change_id: "pay", artifact: "specs", ...(revision ? { if_context_revision: revision } : {}),
    } });
    assert.notEqual(response.isError, true, JSON.stringify(response.content));
    return JSON.parse(response.content[0].text);
  };
  const uri = (name) => `openspec-orch://store/specs/${name}`;
  let previous = await readContext();
  for (const name of shared) {
    assert.ok(previous.shared_resources.some((resource) => resource.name === name), name);
    assert.equal((await client.readResource({ uri: uri(name) })).contents[0].text, "# Original\n");
  }
  await assert.rejects(client.readResource({ uri: uri("openspec/process/private.md") }), /MCP_RESOURCE_NOT_FOUND/u);
  assert.equal((await readContext(previous.context_revision)).unchanged, true);
  for (const name of ["openspec/changes/pay/proposal.md", ...shared]) {
    await fs.writeFile(path.join(root, name), "# Changed content\n");
    const current = await readContext(previous.context_revision);
    assert.notEqual(current.unchanged, true, name);
    assert.notEqual(current.context_revision, previous.context_revision, name);
    assert.equal((await readContext(current.context_revision)).unchanged, true, name);
    previous = current;
  }
  // A different Change is outside this Work Context.
  await fs.writeFile(path.join(root, "openspec/changes/other/proposal.md"), "# Unrelated update\n");
  assert.equal((await readContext(previous.context_revision)).unchanged, true);
  await fs.rm(path.join(root, shared[0]));
  const removed = await readContext(previous.context_revision);
  assert.notEqual(removed.context_revision, previous.context_revision);
  assert.equal(removed.shared_resources.some(({ name }) => name === shared[0]), false);
  await fs.writeFile(path.join(root, shared[0]), "# Restored\n");
  assert.notEqual((await readContext(removed.context_revision)).context_revision, removed.context_revision);
});
