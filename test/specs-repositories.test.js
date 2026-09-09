/** @fileoverview Mixed workspace isolation: linked Stores, Graph and Agent resources. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  configuration, ConnectionService, createProject, GitService, PluginContextFactory,
  PluginLoader, ProcessService, repositoryStatuses, storeProjects,
} from "@openspec-orch/core";

import { AgentPackPlan } from "../packages/core/internal/agent-pack.js";
import { createDirectoryLink } from "../packages/core/fixtures/filesystem.js";
import { OrchestratorMcpRuntime } from "../bin/internal/orchestrator-mcp-runtime.js";
import { OpenSpecGraphApplication } from "../plugins/openspec-graph/lib/application.js";

const graphRoot = fileURLToPath(new URL("../plugins/openspec-graph/", import.meta.url));

/** Writes and commits ordinary files without using network or user Git identity. */
async function gitRepository(root, remote, files) {
  await fs.mkdir(root, { recursive: true });
  await execa("git", ["init", "--initial-branch", "main", root]);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  await execa("git", ["-C", root, "remote", "add", "origin", remote]);
  await execa("git", ["-C", root, "add", "."]);
  await execa("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.test",
    "commit", "-m", "fixture"]);
}

/** Creates project data; a linked Store's unavailable packages are deliberately not installed. */
function project(id, repositories, plugins = [], bindings = [], remote = `https://example.test/${id}.git`) {
  return createProject({
    version: 1, strict: true, template: { id: "default" }, agent: { id: "qwen" },
    plugins, extensions: [], repositories: [{
      id, role: "store", remote,
      defaultBranch: "main", plugins: bindings,
    }, ...repositories],
  });
}

/** Supplies a real Git transport mapped to local sources and spies on root-only setup. */
async function scenario(t, { sharedStoreId = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "orch-linked-specs-")));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const ownerRoot = path.join(root, "specs");
  const sources = new Map();
  const attachments = [];
  for (const alias of ["payments", "platform"]) {
    const id = sharedStoreId ? "specs" : `team-${alias}`;
    const remote = `https://example.test/team-${alias}.git`;
    const source = path.join(root, `team-${alias}-source`);
    const team = project(id, [{
      id: `${alias}-api`, role: "code", remote: `https://example.test/${alias}-api.git`,
      defaultBranch: "main", plugins: [],
    }, {
      id: "nested", role: "specs", storeId: "nested-team",
      remote: "https://example.test/nested.git", defaultBranch: "main", plugins: [],
    }], ["unavailable-team-plugin"], [], remote);
    await gitRepository(source, remote, {
      ".openspec-store/store.yaml": `version: 1\nid: ${id}\nremote: ${remote}\n`,
      "openspec-orch.yaml": configuration.serializeProject(team),
      "openspec/config.yaml": "schema: spec-driven\n",
      "openspec/specs/shared/spec.md": `# ${alias}\n\n## Purpose\nThis specification describes the ${alias} service and its observable request handling contract.\n\n## Requirements\n\n### Requirement: Service available\nThe system SHALL serve ${alias}.\n\n#### Scenario: Request\n- **WHEN** a request arrives\n- **THEN** the system responds\n`,
    });
    sources.set(remote, source);
    attachments.push({ id: alias, role: "specs", storeId: id, remote,
      defaultBranch: "main", plugins: ["openspec-graph"] });
  }
  const codeRemote = "https://example.test/management-api.git";
  const codeSource = path.join(root, "code-source");
  await gitRepository(codeSource, codeRemote, { "README.md": "management code\n" });
  sources.set(codeRemote, codeSource);
  const owner = project("specs", [{
    id: "management-api", role: "code", remote: codeRemote, defaultBranch: "main", plugins: [],
  }, ...attachments], ["openspec-graph"], ["openspec-graph"]);
  await gitRepository(ownerRoot, owner.storeRepository.remote, {
    ".openspec-store/store.yaml": `version: 1\nid: specs\nremote: ${owner.storeRepository.remote}\n`,
    "openspec-orch.yaml": configuration.serializeProject(owner),
    "openspec/config.yaml": "schema: spec-driven\n",
  });
  const calls = [];
  const processService = new ProcessService(async (executable, args, options) => {
    calls.push({ executable, args, cwd: options.cwd });
    if (executable === "git" && args[0] === "clone") {
      const remote = args.at(-2);
      assert.equal(sources.has(remote), true, `Unexpected recursive clone: ${remote}`);
      const result = await execa(executable, args.map((arg) => arg === remote ? sources.get(remote) : arg), options);
      await execa("git", ["-C", args.at(-1), "remote", "set-url", "origin", remote]);
      return result;
    }
    return execa(executable, args, options);
  });
  const setupCalls = [];
  const connection = new ConnectionService({
    gitService: new GitService(processService),
    agentPackService: { plan: async () => new AgentPackPlan([
      { relative: ".qwen/commands/project.md", contents: "manager instructions" },
    ]) },
    openSpecService: { forRepository(checkout) {
      setupCalls.push(checkout.root);
      assert.equal(checkout.repository.isSpecs(), false);
      return {
        async version() {}, async registerStore() {}, async assertStoreHealthy() {},
        async doctor() {}, async assertContext() {},
      };
    } },
  });
  const loadedPlugin = await new PluginLoader().load({ packageRoot: graphRoot, pluginId: "openspec-graph" });
  return { root, ownerRoot, owner, connection, calls, setupCalls, loadedPlugin };
}

/** Composes the actual Agent runtime with the owner's installed Graph implementation. */
function runtime(s, repositoryParameter = "store_repository_id") {
  const contribution = s.loadedPlugin.plugin.agentContribution();
  return new OrchestratorMcpRuntime({
    start: s.ownerRoot,
    agentContributions: [{ pluginId: "openspec-graph", contribution: {
      ...contribution, tools: contribution.tools.map((tool) => ({ ...tool, repositoryParameter })),
    } }],
    managerService: { forStore() { return { async resolve(declaration) {
      assert.equal(declaration.id, "openspec-graph");
      return { loadedPlugin: s.loadedPlugin };
    } }; } },
    doctorService: { async inspect() { return { toJSON: () => ({}) }; } },
    setupService: { async connect() {}, async initialize() {}, inspect() {} },
  });
}

test("mixed connect clones exactly one level, preserves team files and reports local snapshots", async (t) => {
  const s = await scenario(t);
  const first = await s.connection.connect({ start: s.ownerRoot });
  assert.deepEqual(first.repositories.map(({ role }) => role), ["code", "specs", "specs"]);
  assert.equal(first.repositories[0].pointerCreated, true);
  for (const linked of first.repositories.slice(1)) {
    assert.equal(linked.path, path.join(s.root, "linked-specs", linked.id));
    assert.equal(linked.storeId, `team-${linked.id}`);
    assert.equal(linked.pointerCreated, null);
    assert.equal(linked.clean, true);
    assert.equal(await fs.readFile(path.join(linked.path, "openspec/config.yaml"), "utf8"), "schema: spec-driven\n");
    for (const absent of [".qwen", ".openspec-orch", "src", "linked-specs"]) {
      await assert.rejects(fs.stat(path.join(linked.path, absent)), { code: "ENOENT" });
    }
  }
  const second = await s.connection.connect({ start: s.ownerRoot });
  assert.equal(second.repositories.every(({ cloned }) => !cloned), true);
  assert.equal(s.calls.filter(({ args }) => args[0] === "clone").length, 3);
  const target = path.join(s.root, "linked-specs/payments");
  await execa("git", ["-C", target, "switch", "--detach", "HEAD"]);
  await fs.writeFile(path.join(target, "local.md"), "local reference");
  const relaxed = await s.connection.connect({ start: s.ownerRoot, noStrict: true });
  assert.equal(relaxed.repositories[1].clean, false);
  assert.equal(relaxed.repositories[1].branch, "");
  assert.equal(relaxed.repositories[1].revision.length, 40);
  // Existing employee context still belongs to the team, not the manager.
  assert.equal((await storeProjects.resolve(target)).store.id, "team-payments");
});

test("Graph and MCP use each team's registry and separate identical resource names", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const owner = await storeProjects.load(s.ownerRoot);
  const factory = new PluginContextFactory();
  const agent = runtime(s);
  for (const alias of ["payments", "platform"]) {
    const context = await factory.forRepository({ loadedPlugin: s.loadedPlugin, storeProject: owner, repositoryId: alias });
    assert.equal(context.project.id, "specs");
    assert.equal(context.repository.role, "specs");
    assert.equal(context.targetStore.id, `team-${alias}`);
    assert.equal(context.targetStore.repositories.some(({ id }) => id === `${alias}-api`), true);
    assert.equal(context.project.repositories.some(({ id }) => id === `${alias}-api`), false);
    const graph = await new OpenSpecGraphApplication(context).compile();
    assert.equal(graph.summary.errors, 0);
    assert.equal(graph.nodes.some(({ id }) => id === `store:team-${alias}`), true);
    assert.equal(graph.nodes.some(({ id }) => id.includes("management-api")), false);
    const report = await agent.invokeAgentTool("get_spec_graph", { store_repository_id: alias });
    assert.deepEqual(report, graph);
  }
  const resources = await agent.listResources();
  const copies = resources.filter(({ name }) => name === "openspec/specs/shared/spec.md");
  assert.equal(copies.length, 2);
  assert.notEqual(copies[0].uri, copies[1].uri);
  for (const resource of copies) {
    const read = await agent.readResource(resource.uri);
    assert.match(read.text, new RegExp(resource._meta.source.repository_id));
    assert.equal(read._meta.source.revision.length, 40);
    assert.equal(read._meta.source.clean, true);
    assert.equal(read._meta.source.store_id, `team-${read._meta.source.repository_id}`);
  }
  const own = await agent.invokeAgentTool("get_spec_graph", {});
  assert.equal(own.nodes.some(({ id }) => id === "store:specs"), true);
  const legacy = await runtime(s, null).invokeAgentTool("get_spec_graph", {
    store_repository_id: "platform",
  });
  assert.equal(legacy.nodes.some(({ id }) => id === "store:specs"), true);
  await assert.rejects(agent.invokeAgentTool("get_spec_graph", { store_repository_id: "unknown" }), /REPO_UNKNOWN/);
  await assert.rejects(agent.invokeAgentTool("get_spec_graph", { store_repository_id: "management-api" }), /PLUGIN_NOT_CONNECTED/);
  const changed = await storeProjects.load(s.ownerRoot);
  changed.project.connectPlugin("openspec-graph", ["management-api"]);
  await fs.writeFile(path.join(s.ownerRoot, "openspec-orch.yaml"), configuration.serializeProject(changed.project));
  await assert.rejects(agent.invokeAgentTool("get_spec_graph", { store_repository_id: "management-api" }), /PLUGIN_SCOPE_UNSUPPORTED/);
  await assert.rejects(agent.readResource(copies[0].uri.replace("openspec/specs/shared/spec.md", "../../specs/openspec-orch.yaml")), /MCP_RESOURCE_NOT_FOUND/);
  for (const alias of ["payments", "platform"]) {
    assert.equal((await execa("git", ["-C", path.join(s.root, "linked-specs", alias), "status", "--porcelain"])).stdout, "");
  }
});

test("linked identity fails closed even in relaxed mode and status exposes invalid metadata", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const target = path.join(s.root, "linked-specs/payments");
  const configPath = path.join(s.ownerRoot, "openspec-orch.yaml");
  const original = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, original.replace("store_id: team-payments", "store_id: different-team"));
  await assert.rejects(s.connection.connect({ start: s.ownerRoot, noStrict: true }), /SPECS_IDENTITY_MISMATCH/);
  await fs.writeFile(configPath, original);
  await fs.writeFile(path.join(target, "openspec/config.yaml"), "store: specs\n");
  await assert.rejects(s.connection.connect({ start: s.ownerRoot }), /SPECS_CONFIG_INVALID/);
  await fs.writeFile(path.join(target, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(target, ".openspec-store/store.yaml"), "version: 1\nid: wrong\nremote: https://example.test/wrong.git\n");
  await assert.rejects(s.connection.connect({ start: s.ownerRoot, noStrict: true }), /Store ID/);
  const [status] = await repositoryStatuses.inspect({ start: s.ownerRoot, repositoryIds: ["payments"] });
  assert.equal(status.state, "invalid_specs");
  assert.equal(status.connected, false);
  const resources = await runtime(s).listResources();
  assert.equal(resources.some(({ _meta }) => _meta.source?.repository_id === "payments"), false);
  assert.equal(resources.some(({ _meta }) => _meta.source?.repository_id === "platform"), true);
  await execa("git", ["-C", target, "remote", "set-url", "origin", "https://example.test/wrong.git"]);
  await assert.rejects(s.connection.connect({ start: s.ownerRoot, noStrict: true }), /origin/);
});

test("linked checkout refuses a symlink container before cloning", async (t) => {
  const s = await scenario(t);
  const external = path.join(s.root, "external");
  await fs.mkdir(external);
  await createDirectoryLink(external, path.join(s.root, "linked-specs"));
  await assert.rejects(s.connection.connect({ start: s.ownerRoot }), /обычным каталогом/);
  assert.deepEqual(await fs.readdir(external), []);
});


test("public CLI and stdio MCP select linked Graph bindings from the owner's runtime", async (t) => {
  const s = await scenario(t);
  const config = s.owner.toConfig();
  const management = createProject({ ...config,
    repositories: config.repositories.filter(({ role }) => role !== "code"),
  });
  await fs.writeFile(path.join(s.ownerRoot, "openspec-orch.yaml"), configuration.serializeProject(management));
  const connected = await s.connection.connect({ start: s.ownerRoot });
  assert.deepEqual(connected.repositories.map(({ role }) => role), ["specs", "specs"]);
  assert.deepEqual(await fs.readdir(path.join(s.root, "src")), []);
  const cli = fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));
  const { stdout } = await execa(process.execPath, [cli, "plugin", "exec", "--repo", "payments", "openspec-graph",
    "inspect", "--json"], { cwd: s.ownerRoot });
  const report = JSON.parse(stdout);
  assert.equal(report.source.repository_id, "payments");
  assert.equal(report.source.store_id, "team-payments");
  assert.equal(report.summary.errors, 0);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../bin/openspec-orch-mcp.js", import.meta.url))],
    cwd: s.ownerRoot, env: { ...process.env }, stderr: "pipe",
  });
  const client = new Client({ name: "linked-specs-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: "get_spec_graph", arguments: {
      store_repository_id: "platform",
    } });
    assert.notEqual(response.isError, true, JSON.stringify(response.content));
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.source.repository_id, "platform");
    const nodeResponse = await client.callTool({ name: "get_spec_graph_node", arguments: {
      store_repository_id: "platform", node_id: "master-spec:shared",
    } });
    assert.notEqual(nodeResponse.isError, true, JSON.stringify(nodeResponse.content));
    const node = JSON.parse(nodeResponse.content[0].text);
    assert.equal(node.node.id, "master-spec:shared");
    assert.equal(node.source.repository_id, "platform");
    for (const [name, args] of [
      ["get_spec_graph", { repository_id: "platform" }],
      ["get_spec_graph", { query: "report" }],
      ["get_spec_graph_node", { id: "master-spec:shared" }],
      ["get_spec_graph_node", {}],
      ["get_spec_change_impact", {}],
    ]) {
      const invalid = await client.callTool({ name, arguments: args });
      assert.equal(invalid.isError, true);
      assert.match(JSON.stringify(invalid.content), /MCP_TOOL_INPUT_INVALID/);
    }
    const resources = await client.listResources();
    const resource = resources.resources.find(({ _meta }) =>
      _meta?.source?.repository_id === "platform" && _meta?.source?.store_id === "team-platform");
    assert.ok(resource);
    const read = await client.readResource({ uri: resource.uri });
    assert.equal(read.contents[0]._meta.source.store_id, "team-platform");
    // A long-lived server must recheck the binding after a config edit.
    const current = await storeProjects.load(s.ownerRoot);
    current.project.disconnectPlugin("openspec-graph", "platform");
    await fs.writeFile(path.join(s.ownerRoot, "openspec-orch.yaml"), configuration.serializeProject(current.project));
    const unbound = await client.callTool({ name: "get_spec_graph", arguments: {
      store_repository_id: "platform",
    } });
    assert.equal(unbound.isError, true);
    assert.match(JSON.stringify(unbound.content), /PLUGIN_NOT_CONNECTED/);
    await fs.writeFile(path.join(s.root, "linked-specs/payments/openspec/config.yaml"), "schema: []\n");
    const partial = await client.listResources();
    assert.ok(partial.resources.some(({ uri }) => uri === resource.uri));
    const diagnostic = partial.resources.find(({ _meta }) => _meta?.diagnostic?.repository_id === "payments");
    assert.ok(diagnostic);
    const diagnosticRead = await client.readResource({ uri: diagnostic.uri });
    assert.equal(diagnosticRead.contents[0]._meta.diagnostic.expected_store_id, "team-payments");
    assert.match(diagnosticRead.contents[0].text, /schema/);
    assert.equal((await client.readResource({ uri: resource.uri })).contents[0]._meta.source.store_id, "team-platform");
  } finally {
    await client.close();
  }
});


test("distinct remotes may share the owner's Store ID without resource or Graph ambiguity", async (t) => {
  const s = await scenario(t, { sharedStoreId: true });
  const connected = await s.connection.connect({ start: s.ownerRoot });
  assert.deepEqual(connected.repositories.slice(1).map(({ storeId }) => storeId), ["specs", "specs"]);
  const agent = runtime(s);
  const resources = (await agent.listResources()).filter(({ name }) => name === "openspec/specs/shared/spec.md");
  assert.equal(new Set(resources.map(({ uri }) => uri)).size, 2);
  for (const repository_id of ["payments", "platform"]) {
    const result = await agent.invokeAgentTool("get_spec_graph", { store_repository_id: repository_id });
    assert.equal(result.source.store_id, "specs");
    assert.equal(result.source.repository_id, repository_id);
    assert.equal(result.nodes.some(({ id }) => id === `repository:${repository_id}-api`), true);
  }
});

test("registry Git and direct specs context reject the same replaced Store", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const storeProject = await storeProjects.load(s.ownerRoot);
  const factory = new PluginContextFactory();
  const options = { loadedPlugin: s.loadedPlugin, storeProject };
  const context = await factory.forRepository({ ...options, repositoryId: "specs" });
  const target = path.join(s.root, "linked-specs/payments");
  assert.equal((await (await context.repositories.git("payments")).revision()).length, 40);
  await execa("git", ["-C", target, "remote", "set-url", "origin", "https://example.test/wrong.git"]);
  for (const resolve of [() => context.repositories.context("payments"), () => context.repositories.git("payments"),
    () => factory.forRepository({ ...options, repositoryId: "payments" })]) {
    await assert.rejects(resolve(), /origin/);
  }
  await execa("git", ["-C", target, "remote", "set-url", "origin", "https://example.test/team-payments.git"]);
  await fs.writeFile(path.join(target, ".openspec-store/store.yaml"), "version: 1\nid: wrong\nremote: https://example.test/team-payments.git\n");
  for (const resolve of [() => context.repositories.context("payments"), () => context.repositories.git("payments"),
    () => factory.forRepository({ ...options, repositoryId: "payments" })]) {
    await assert.rejects(resolve(), /Store ID/);
  }
});

test("broken linked resources expose diagnostics while healthy sources stay readable", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const agent = runtime(s);
  const configPath = path.join(s.root, "linked-specs/payments/openspec/config.yaml");
  const healthy = await agent.listResources();
  const original = healthy.find(({ name, _meta }) =>
    _meta.source?.repository_id === "payments" && name === "openspec/specs/shared/spec.md");
  await fs.writeFile(configPath, "schema: []\n");
  await assert.rejects(s.connection.connect({ start: s.ownerRoot }), /SPECS_CONFIG_INVALID/);
  const [status] = await repositoryStatuses.inspect({ start: s.ownerRoot, repositoryIds: ["payments"] });
  assert.equal(status.state, "invalid_specs");
  assert.match(status.error, /schema/);
  const resources = await agent.listResources();
  assert.ok(resources.some(({ uri }) => uri.startsWith("openspec-orch://store/specs/")));
  const platform = resources.find(({ _meta }) => _meta.source?.repository_id === "platform");
  assert.ok(platform);
  assert.ok((await agent.readResource(platform.uri)).text);
  const diagnostic = resources.find(({ _meta }) => _meta.diagnostic?.repository_id === "payments");
  assert.ok(diagnostic);
  assert.equal(diagnostic._meta.diagnostic.expected_store_id, "team-payments");
  assert.match((await agent.readResource(diagnostic.uri)).text, /schema/);
  await assert.rejects(agent.readResource(original.uri), /SPECS_RESOURCE_UNAVAILABLE/);
  // A resource-layer error can also occur after valid Store metadata/config.
  await fs.writeFile(configPath, "schema: spec-driven\n");
  const change = path.join(s.root, "linked-specs/payments/openspec/changes/broken");
  await fs.mkdir(change, { recursive: true });
  await fs.writeFile(path.join(change, ".openspec.yaml"), "schema: []\n");
  assert.match((await agent.readResource(original.uri)).text, /^# payments/u);
  const partial = await agent.listResources();
  assert.ok(partial.some(({ _meta }) => _meta.source?.repository_id === "platform"));
  assert.match(partial.find(({ _meta }) => _meta.diagnostic)?.description, /MCP_RESOURCE_SCHEMA_INVALID/);
  await fs.rm(change, { recursive: true });
  const recovered = await agent.listResources();
  assert.equal(recovered.some(({ _meta }) => _meta.diagnostic), false);
  assert.ok((await agent.readResource(original.uri)).text);
  await assert.rejects(agent.readResource(diagnostic.uri), /MCP_RESOURCE_NOT_FOUND/);
});

test("parent Graph lists linked Stores and registry contexts recheck current bindings", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const storeProject = await storeProjects.load(s.ownerRoot);
  const context = await new PluginContextFactory().forRepository({
    loadedPlugin: s.loadedPlugin, storeProject, repositoryId: "specs",
  });
  const graph = await new OpenSpecGraphApplication(context).compile();
  assert.deepEqual(graph.nodes.filter(({ role }) => role === "specs").map(({ repository_id }) => repository_id), ["payments", "platform"]);
  const selected = await context.repositories.context("payments");
  assert.equal(selected.targetStore.id, "team-payments");
  const childGraph = await new OpenSpecGraphApplication(selected).compile();
  assert.deepEqual(childGraph.nodes.filter(({ role }) => role === "specs").map(({ repository_id }) => repository_id), ["nested"]);
  assert.equal(childGraph.source.repository_id, "payments");
  await assert.rejects(context.repositories.context("nested"), /REPO_UNKNOWN/);
  await assert.rejects(context.repositories.context("management-api"), /PLUGIN_NOT_CONNECTED|PLUGIN_UNSUPPORTED/);
  storeProject.project.disconnectPlugin("openspec-graph", "payments");
  await fs.writeFile(path.join(s.ownerRoot, "openspec-orch.yaml"), configuration.serializeProject(storeProject.project));
  await assert.rejects(context.repositories.context("payments"), /PLUGIN_NOT_CONNECTED/);
  assert.equal((await context.repositories.context("platform")).targetStore.id, "team-platform");
});

test("parent initiative links two specs repositories without unknown or duplicate nodes", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const change = path.join(s.ownerRoot, "openspec/changes/shared-refunds");
  await fs.mkdir(path.join(change, "specs/refunds"), { recursive: true });
  await fs.writeFile(path.join(change, ".openspec.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(change, "specs/refunds/spec.md"),
    "## ADDED Requirements\n\n### Requirement: Shared refunds\nThe system SHALL coordinate a traceable refund across payment processing and platform authorization.\n\n#### Scenario: Authorized request\n- **WHEN** an authorized customer requests an eligible refund\n- **THEN** the system returns a tracking identifier\n");
  await fs.writeFile(path.join(change, "proposal.md"),
    "# Shared refunds\n\n## Why\nCustomers need a traceable refund across two teams.\n\n## What Changes\n- Add coordinated refunds.\n\n## Capabilities\n\n### New Capabilities\n- `refunds`: shared refund contract.\n\n### Modified Capabilities\n\n## Impact\nPayments and Platform participate in the shared refund workflow.\n\n## Repository Impact\n\n| Repository | Capabilities |\n| --- | --- |\n| `payments` | `refunds` |\n| `platform` | `refunds` |\n");
  const agent = runtime(s);
  const report = await agent.invokeAgentTool("get_spec_graph", {});
  assert.equal(report.summary.errors, 0, JSON.stringify(report.diagnostics));
  assert.equal(new Set(report.nodes.map(({ id }) => id)).size, report.nodes.length);
  for (const id of ["payments", "platform"]) {
    const selected = report.nodes.find((node) => node.id === `repository:${id}`);
    assert.equal(selected.role, "specs");
    assert.equal(selected.state, "registered");
    for (const relation of ["changes_in", "linked"]) {
      const edge = report.edges.find((value) => value.relation === relation &&
        (relation === "changes_in" ? value.target === selected.id : value.source === selected.id));
      assert.ok(edge);
      assert.equal(edge.status, "ok");
      assert.ok(edge.provenance.every(({ path: sourcePath }) => sourcePath.endsWith("shared-refunds/proposal.md")));
    }
  }
  const impact = await agent.invokeAgentTool("get_spec_change_impact", { change_id: "shared-refunds" });
  assert.deepEqual(impact.repositories.map(({ repository_id, role }) => ({ repository_id, role })), [
    { repository_id: "payments", role: "specs" }, { repository_id: "platform", role: "specs" },
  ]);
});

test("linked Graph preserves nested specs registry without loading nested Stores", async (t) => {
  const s = await scenario(t);
  await s.connection.connect({ start: s.ownerRoot });
  const target = path.join(s.root, "linked-specs/payments");
  const change = path.join(target, "openspec/changes/nested-change");
  await fs.mkdir(path.join(change, "specs/shared"), { recursive: true });
  await fs.writeFile(path.join(change, "proposal.md"),
    "# Nested initiative\n\n## Repository Impact\n\n| Repository | Capabilities |\n| --- | --- |\n| `nested` | `shared` |\n");
  await fs.writeFile(path.join(change, "specs/shared/spec.md"),
    "## ADDED Requirements\n\n### Requirement: Shared outcome\nThe system SHALL report the shared outcome.\n\n#### Scenario: Completed\n- **WHEN** both teams finish\n- **THEN** the outcome is reported\n");
  const context = await new PluginContextFactory().forRepository({
    loadedPlugin: s.loadedPlugin, storeProject: await storeProjects.load(s.ownerRoot), repositoryId: "payments",
  });
  const graph = await new OpenSpecGraphApplication(context).compile();
  assert.equal(graph.state, "ready");
  const nested = graph.nodes.find(({ id }) => id === "repository:nested");
  assert.equal(nested.state, "registered");
  assert.equal(nested.role, "specs");
  assert.equal(graph.nodes.some(({ id }) => id === "store:nested-team"), false);
  assert.equal(s.calls.some(({ args }) => args.includes("https://example.test/nested.git")), false);
});
