/** @fileoverview Apply reads Store artifacts through MCP from a separate Code checkout. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { configuration, createProject } from "@openspec-orch/core";
import { execa } from "execa";

import { OrchestratorMcpRuntime } from "../src/bin/internal/orchestrator-mcp-runtime.js";

const serverPath = fileURLToPath(new URL("../src/bin/openspec-orch-mcp.js", import.meta.url));

/** Creates isolated Store and Code repositories without optional Plugins or provider setup. */
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mcp-apply-resources-")));
  const client = new Client({ name: "apply-resources", version: "1.0.0" });
  t.after(async () => {
    try { await client.close(); } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  const store = path.join(root, "specs");
  const code = path.join(root, "src/frontend");
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data") };
  const write = async (name, text) => {
    const target = path.join(store, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  };
  await write(".openspec-store/store.yaml", "version: 1\nid: specs\nremote: https://example.test/specs.git\n");
  await write("openspec-orch.yaml", configuration.serializeProject(createProject({
    version: 1, strict: true, template: { id: "default" }, agent: { id: "qwen" },
    extensions: [], plugins: [], repositories: [
      { id: "specs", role: "store", remote: "https://example.test/specs.git", defaultBranch: "main", plugins: [] },
      { id: "frontend", role: "code", remote: "https://example.test/frontend.git", defaultBranch: "main", plugins: [] },
    ],
  })));
  await write("openspec/config.yaml", "schema: spec-driven\n");
  await write("openspec/changes/pay/.openspec.yaml", "schema: spec-driven\n");
  for (const name of ["proposal.md", "design.md", "specs/first/spec.md", "specs/second/spec.md"]) {
    await write(`openspec/changes/pay/${name}`, `# ${name}\nApply source.\n`);
  }
  await write("openspec/changes/pay/tasks.md", "## frontend\n- [ ] 1.1 Implement payment\n");
  await write("openspec/specs/payments/spec.md", "# Master Spec\n");
  await write("openspec/context/private.txt", "unpublished\n");
  await fs.mkdir(path.join(code, "openspec"), { recursive: true });
  await fs.writeFile(path.join(code, "openspec/config.yaml"), "store: specs\n");
  for (const cwd of [store, code]) await execa("git", ["init", "--initial-branch", "main"], { cwd });
  return { client, code, env, root, store, write };
}

test("Code checkout reads complete Apply artifacts and Master Specs using only MCP tools", async (t) => {
  const { client, code, env, store, write } = await fixture(t);
  await execa("openspec", ["store", "register", store, "--id", "specs", "--yes", "--json"], { cwd: code, env });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [serverPath], cwd: code, env, stderr: "pipe",
  }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  };
  const context = await call("get_change_context", { change_id: "pay", artifact: "apply", include_assignment: true });
  assert.equal(context.current_repository.role, "code");
  assert.equal(context.current_repository.path, code);
  assert.equal(context.assignment_scope.current_assignment.repository_id, "frontend");
  assert.deepEqual(context.project.plugins, []);
  assert.equal(context.artifact_instructions.state, "ready");
  assert.deepEqual(Object.keys(context.context_resources), Object.keys(context.artifact_instructions.contextFiles));
  assert.equal(context.context_resources.specs.length, 2);
  for (const [artifact, resources] of Object.entries(context.context_resources)) {
    assert.deepEqual(resources.map(({ name }) => path.resolve(store, name)), context.artifact_instructions.contextFiles[artifact]);
    for (const resource of resources) {
      const read = await call("read_spec_resource", { uri: resource.uri });
      assert.equal(read.text, await fs.readFile(path.join(store, resource.name), "utf8"));
      assert.equal(read._meta.content_revision, resource._meta.content_revision);
    }
  }
  const master = context.shared_resources.find(({ name }) => name === "openspec/specs/payments/spec.md");
  const before = await call("read_spec_resource", { uri: master.uri });
  assert.equal(before.text, "# Master Spec\n");
  assert.equal((await call("read_spec_resource", { uri: master.uri, if_context_revision: before.context_revision })).unchanged, true);
  await write(master.name, "# Revised Master Spec\n");
  const after = await call("read_spec_resource", { uri: master.uri, if_context_revision: before.context_revision });
  assert.equal(after.text, "# Revised Master Spec\n");
  assert.notEqual(after._meta.content_revision, before._meta.content_revision);
  assert.equal((await client.readResource({ uri: master.uri })).contents[0].text, after.text);

  for (const uri of [
    path.join(store, master.name), `file://${store}/${master.name}`,
    "openspec-orch://store/other/openspec/config.yaml",
    "openspec-orch://store/specs/openspec/context/private.txt",
    "openspec-orch://store/specs/openspec/context/%2e%2e/private.md",
    "openspec-orch://store/specs/openspec/context/missing.md",
  ]) {
    const rejected = await client.callTool({ name: "read_spec_resource", arguments: { uri } });
    assert.equal(rejected.isError, true, uri);
    assert.match(rejected.content[0].text, /MCP_RESOURCE_NOT_FOUND/u);
  }
  await fs.rm(path.join(store, master.name));
  const removed = await client.callTool({ name: "read_spec_resource", arguments: {
    uri: master.uri, if_context_revision: after.context_revision,
  } });
  assert.equal(removed.isError, true);
  assert.match(removed.content[0].text, /MCP_RESOURCE_NOT_FOUND/u);
});

test("context mapping preserves custom artifact groups and rejects unresolvable or malformed inputs", async (t) => {
  const { store, write } = await fixture(t);
  await write("openspec/schemas/custom/schema.yaml", "name: custom\nversion: 1\nartifacts:\n  - id: evidence\n    generates: evidence/*.txt\n");
  await write("openspec/changes/pay/.openspec.yaml", "schema: custom\n");
  await write("openspec/changes/pay/evidence/second.txt", "Second\n");
  await write("openspec/changes/pay/evidence/first.txt", "First\n");
  let instructions = { contextFiles: { evidence: [
    path.join(store, "openspec/changes/pay/evidence/second.txt"),
    "openspec/changes/pay/evidence/first.txt",
  ], empty: [] } };
  const runtime = new OrchestratorMcpRuntime({
    start: store,
    managerService: { forStore: () => ({}) },
    doctorService: { inspect: async () => ({ toJSON: () => ({}) }) },
    setupService: { inspect() {}, initialize() {}, connect() {} },
    openSpecService: { forRepository: () => ({
      changeStatus: async () => ({}), artifactInstructions: async () => instructions,
    }) },
  });
  const read = () => runtime.getChangeContext({ change_id: "pay", artifact: "apply" });
  const context = await read();
  assert.equal(context.artifact_instructions, instructions);
  assert.deepEqual(context.context_resources.evidence.map(({ name }) => name), [
    "openspec/changes/pay/evidence/second.txt", "openspec/changes/pay/evidence/first.txt",
  ]);
  assert.deepEqual(context.context_resources.empty, []);
  for (const file of ["../outside.md", "openspec/context/private.txt", "openspec/changes/pay/missing.md"]) {
    instructions = { contextFiles: { evidence: [file] } };
    await assert.rejects(read(), /MCP_CONTEXT_RESOURCE_UNAVAILABLE/u);
  }
  for (const contextFiles of [null, [], "path", { evidence: "path" }, { evidence: [42] }, { evidence: [""] }]) {
    instructions = { contextFiles };
    await assert.rejects(read(), /MCP_CONTEXT_RESOURCE_INVALID/u);
  }
  instructions = {};
  assert.equal((await read()).context_resources, null);
});
