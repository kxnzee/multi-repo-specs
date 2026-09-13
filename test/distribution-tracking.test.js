/** @fileoverview Настоящие Git, OpenSpec, CLI/MCP и переносимый checkpoint установленного кандидата. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parse } from "yaml";
import { MCP_PATH, runCli, commitAll, distributionFixture } from "../test-support/distribution.js";

/** Готовит зафиксированные Tasks и pointer без аккаунтов Git hosting. */
async function prepare(t, customSchema = false) {
  const fixture = await distributionFixture(t, "openspec-tracking-simple-");
  const { storeRoot, codeRoot } = fixture;
  if (customSchema) {
    await fs.cp(new URL("../plugins/change-tracking/fixtures/schema/", import.meta.url),
      path.join(storeRoot, "openspec/schemas/tracking-fixture"), { recursive: true });
  }
  await execa("openspec", ["new", "change", "tracking", "--schema", customSchema ? "tracking-fixture" : "spec-driven"], { cwd: storeRoot });
  const tasksPath = path.join(storeRoot, `openspec/changes/tracking/${customSchema ? "work" : "tasks"}.md`);
  await fs.writeFile(tasksPath, "- [ ] Implement field\n- [ ] Review field\n");
  await commitAll(storeRoot, "Plan tracking");
  await fs.mkdir(path.join(codeRoot, "openspec"), { recursive: true });
  await fs.writeFile(path.join(codeRoot, "openspec/config.yaml"), "store: specs\n");
  await commitAll(codeRoot, "Connect Store");
  const command = ["plugin", "exec", "--repo", "specs", "change-tracking"];
  return { ...fixture, tasksPath, command,
    mapPath: path.join(storeRoot, "openspec/changes/tracking/implementation-map.yaml") };
}

/** Запускает MCP в фиксированном checkout и закрывает его перед удалением fixture. */
async function clientFor(fixture, cwd) {
  const client = new Client({ name: "tracking-smoke", version: "1.0.0" });
  fixture.registerCleanup(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_PATH], cwd,
    env: { ...process.env }, stderr: "pipe" }));
  return client;
}

/** Устанавливает только plugin bindings локального тестового Store. */
async function connect(fixture) {
  await runCli(fixture.storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(fixture.storeRoot, "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend");
  await commitAll(fixture.storeRoot, "Plugin configuration");
}

test("candidate MCP hides disconnected tools, records automatic revisions and rejects calls after disconnect", async (t) => {
  const fixture = await prepare(t);
  const { storeRoot, codeRoot, tasksPath, mapPath } = fixture;
  const client = await clientFor(fixture, codeRoot);
  const args = { change_id: "tracking", task_id: "1" };
  assert.equal((await client.listTools()).tools.some(({ name }) => name === "tracking_start"), false);
  assert.equal((await client.callTool({ name: "tracking_start", arguments: args })).isError, true);
  await connect(fixture);
  assert.equal((await client.listTools()).tools.some(({ name }) => name === "tracking_start"), true);
  assert.equal((await client.listTools()).tools.some(({ name }) => name === "record_implementation"), false);
  for (const invalid of [{ ...args, task_id: "1.1" }, { ...args, pull_request: "https://example.test/1" },
    { ...args, implementation_revision: "a".repeat(40) }]) {
    assert.equal((await client.callTool({ name: "tracking_start", arguments: invalid })).isError, true);
  }
  const base = (await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout;
  const started = await client.callTool({ name: "tracking_start", arguments: args });
  assert.notEqual(started.isError, true, JSON.stringify(started));
  const startedResult = JSON.parse(started.content[0].text);
  assert.equal(startedResult.changed, true);
  assert.match(startedResult.message, /Implement field/);
  assert.equal(started.content[0].text.includes(base), false);
  await fs.writeFile(path.join(codeRoot, "field.js"), "export const field = true;\n");
  await commitAll(codeRoot, "Implement field");
  const revision = (await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout;
  const partial = await client.callTool({ name: "tracking_checkpoint", arguments: { ...args, note: "Review remains" } });
  assert.notEqual(partial.isError, true, JSON.stringify(partial));
  assert.equal((await client.callTool({ name: "tracking_complete", arguments: args })).isError, true);
  await fs.writeFile(tasksPath, "- [x] Implement field\n- [ ] Review field\n");
  const complete = await client.callTool({ name: "tracking_complete", arguments: args });
  assert.notEqual(complete.isError, true, JSON.stringify(complete));
  assert.match(JSON.parse(complete.content[0].text).message, /Implement field/);
  assert.equal(complete.content[0].text.includes(revision), false);
  assert.equal(JSON.parse((await client.callTool({ name: "tracking_complete", arguments: args })).content[0].text).changed, false);
  const document = parse(await fs.readFile(mapPath, "utf8"));
  assert.equal(document.implementations.length, 1);
  assert.equal(document.implementations[0].state, "complete");
  assert.equal(document.implementations[0].base_revision, base);
  assert.equal(document.implementations[0].implementation_revision, revision);
  assert.equal(JSON.stringify(document).includes("https://"), false);
  const short = JSON.parse((await client.callTool({ name: "tracking_status", arguments: args })).content[0].text);
  assert.equal(short.tasks.length, 1);
  assert.equal(short.tasks[0].description, "Implement field");
  assert.equal(short.tasks[0].needs_attention, false);
  assert.equal(short.candidate, undefined);
  assert.equal(short.tasks[0].implementation_revision, undefined);
  assert.equal(short.context.checkout_path, await fs.realpath(codeRoot));
  assert.deepEqual(short.summary, { total_tasks: 2, completed_tasks: 1, recorded_tasks: 1 });
  const details = JSON.parse((await client.callTool({ name: "tracking_status", arguments: { ...args, details: true } })).content[0].text);
  assert.equal(details.tasks[0].implementation_revision, revision);
  assert.equal(details.candidate.repositories[0].revision, revision);
  await fs.writeFile(path.join(codeRoot, "review-note.txt"), "Uncommitted review notes\n");
  const compared = JSON.parse((await client.callTool({ name: "tracking_status", arguments: { ...args, diff: true } })).content[0].text);
  assert.equal(compared.tasks[0].diff.available, true);
  assert.equal(compared.tasks[0].diff.commit_count, 0);
  assert.deepEqual(compared.tasks[0].diff.worktree_files, ["review-note.txt"]);
  assert.equal(compared.tasks[0].diff.from_revision, undefined);
  for (const invalid of [{}, { all: true, change_id: "tracking" }, { change_id: "tracking", diff: true }]) {
    assert.equal((await client.callTool({ name: "tracking_status", arguments: invalid })).isError, true);
  }
  const context = await client.callTool({ name: "get_change_context", arguments: { change_id: "tracking", artifact: "apply" } });
  const tracking = JSON.parse(context.content[0].text).tracking;
  assert.equal(tracking.tasks[0].implementation_revision, undefined, "context keeps technical revisions behind tracking_status");
  await runCli(storeRoot, "plugin", "disconnect", "change-tracking", "--repo", "specs");
  assert.equal((await client.listTools()).tools.some(({ name }) => name === "tracking_start"), false);
  assert.equal((await client.callTool({ name: "tracking_complete", arguments: args })).isError, true);
});

test("custom Apply artifact protects multiline requirements and permits checkbox-only progress", async (t) => {
  const fixture = await prepare(t, true);
  await connect(fixture);
  const { codeRoot, storeRoot, tasksPath, command, mapPath } = fixture;
  await fs.appendFile(tasksPath, "  Extra acceptance condition\n");
  await assert.rejects(runCli(codeRoot, ...command, "start", "tracking", "1"), /TRACKING_PLAN_UNCOMMITTED/);
  await commitAll(storeRoot, "Accept full task text");
  await runCli(codeRoot, ...command, "start", "tracking", "1");
  const focused = JSON.parse((await runCli(codeRoot, ...command, "status", "tracking", "--task", "1", "--json")).stdout);
  assert.equal(focused.context.task_file, "openspec/changes/tracking/work.md");
  assert.equal(focused.context.inputs.includes("openspec/changes/tracking/work.md"), true);
  await fs.appendFile(tasksPath, "  Changed multiline condition\n");
  await assert.rejects(runCli(codeRoot, ...command, "checkpoint", "tracking", "1"), /TRACKING_PLAN_CHANGED/);
  await assert.rejects(fs.access(mapPath), { code: "ENOENT" });
  await commitAll(storeRoot, "Revise requirements");
  await runCli(codeRoot, ...command, "start", "tracking", "1", "--restart");
  await fs.writeFile(tasksPath, (await fs.readFile(tasksPath, "utf8")).replace("- [ ] Implement", "- [x] Implement"));
  await runCli(codeRoot, ...command, "complete", "tracking", "1");
  assert.equal(parse(await fs.readFile(mapPath, "utf8")).implementations[0].state, "complete");
  // Обзор берёт список из OpenSpec, включая Changes без карты и с другой схемой.
  await execa("openspec", ["new", "change", "alpha-untracked", "--schema", "spec-driven"], { cwd: storeRoot });
  await fs.writeFile(path.join(storeRoot, "openspec/changes/alpha-untracked/tasks.md"), "- [ ] Another task\n");
  await fs.mkdir(path.join(storeRoot, "openspec/changes/archive/old-change"), { recursive: true });
  await fs.writeFile(path.join(storeRoot, "openspec/changes/archive/old-change/tasks.md"), "- [x] Old task\n");
  const before = await fs.readFile(mapPath, "utf8");
  const overview = JSON.parse((await runCli(storeRoot, ...command, "status", "--all", "--json")).stdout);
  assert.deepEqual(overview.changes.map(({ change_id }) => change_id), ["alpha-untracked", "tracking"]);
  assert.deepEqual(overview.changes[0].summary, { total_tasks: 1, completed_tasks: 0, recorded_tasks: 0 });
  assert.deepEqual(overview.changes[1].summary, { total_tasks: 2, completed_tasks: 1, recorded_tasks: 1 });
  const client = await clientFor(fixture, storeRoot);
  const mcp = await client.callTool({ name: "tracking_status", arguments: { all: true } });
  assert.notEqual(mcp.isError, true, JSON.stringify(mcp));
  assert.deepEqual(JSON.parse(mcp.content[0].text).changes, overview.changes);
  assert.equal((await runCli(storeRoot, ...command, "status", "--all")).stdout.trim().split("\n").length, 2);
  await assert.rejects(runCli(codeRoot, ...command, "status", "tracking", "--all"), /TRACKING_INPUT_INVALID/);
  await assert.rejects(runCli(codeRoot, ...command, "status", "tracking", "--diff"), /TRACKING_INPUT_INVALID/);
  assert.equal(await fs.readFile(mapPath, "utf8"), before);
});

test("candidate CLI resumes a checkpoint from a different worktree and protects against stale writers", async (t) => {
  const fixture = await prepare(t);
  const { storeRoot, codeRoot, command, tasksPath, mapPath, registerCleanup } = fixture;
  await connect(fixture);
  await runCli(codeRoot, ...command, "start", "tracking", "1");
  await fs.writeFile(path.join(codeRoot, "field.js"), "export const field = 1;\n");
  await commitAll(codeRoot, "Partial field");
  await runCli(codeRoot, ...command, "checkpoint", "tracking", "1", "--note", "Finish validation");
  await commitAll(storeRoot, "Publish checkpoint");
  const worktree = path.join(path.dirname(codeRoot), "receiver");
  await execa("git", ["worktree", "add", "-b", "receiver", worktree], { cwd: codeRoot });
  registerCleanup(() => execa("git", ["worktree", "remove", "--force", worktree], { cwd: codeRoot }));
  const handoff = JSON.parse((await runCli(worktree, ...command, "status", "tracking", "--task", "1", "--json")).stdout);
  assert.equal(handoff.context.checkout_path, await fs.realpath(worktree));
  assert.equal(handoff.tasks[0].note, "Finish validation");
  assert.equal(handoff.tasks[0].local_work, undefined, "other worktree's cursor does not imply local start");
  await runCli(worktree, ...command, "start", "tracking", "1");
  await fs.writeFile(path.join(worktree, "field.js"), "export const field = 2;\n");
  await commitAll(worktree, "Finish validation");
  const savedMap = await fs.readFile(mapPath, "utf8");
  const diff = JSON.parse((await runCli(worktree, ...command, "status", "tracking", "--task", "1", "--diff", "--json")).stdout);
  assert.equal(diff.tasks[0].diff.available, true);
  assert.equal(diff.tasks[0].diff.commit_count, 1);
  assert.deepEqual(diff.tasks[0].diff.committed_files, ["field.js"]);
  const original = JSON.parse((await runCli(codeRoot, ...command, "status", "tracking", "--task", "1", "--diff", "--json")).stdout);
  assert.equal(original.tasks[0].diff.commit_count, 0, "comparison uses the invoking worktree");
  const readable = (await runCli(worktree, ...command, "status", "tracking", "--task", "1", "--diff")).stdout;
  assert.equal(readable.includes("field.js"), true);
  assert.equal(readable.includes(diff.tasks[0].diff.from_revision), false);
  assert.equal(await fs.readFile(mapPath, "utf8"), savedMap);
  await runCli(worktree, ...command, "checkpoint", "tracking", "1");
  await assert.rejects(runCli(codeRoot, ...command, "checkpoint", "tracking", "1"), /TRACKING_CONFLICT/);
  await fs.writeFile(tasksPath, "- [x] Implement field\n- [ ] Review field\n");
  await runCli(worktree, ...command, "complete", "tracking", "1");
  // Вторая задача может ссылаться на тот же commit, без искусственного нового изменения.
  await runCli(worktree, ...command, "start", "tracking", "2");
  await fs.writeFile(tasksPath, "- [x] Implement field\n- [x] Review field\n");
  await runCli(worktree, ...command, "complete", "tracking", "2");
  const document = parse(await fs.readFile(mapPath, "utf8"));
  assert.equal(document.implementations.length, 2);
  assert.equal(document.implementations[0].implementation_revision, document.implementations[1].implementation_revision);
  const status = JSON.parse((await runCli(worktree, ...command, "status", "tracking", "--json")).stdout);
  assert.equal(status.tasks.every(({ checkout }) => checkout === "matches"), true);
  assert.deepEqual(status.summary, { total_tasks: 2, completed_tasks: 2, recorded_tasks: 2 });
  assert.equal((await runCli(worktree, ...command, "status", "tracking")).stdout.includes(document.implementations[0].implementation_revision), false);
  const before = await fs.readFile(mapPath, "utf8");
  await fs.writeFile(tasksPath, "- [x] New task\n- [x] Implement field\n- [x] Review field\n");
  const stale = JSON.parse((await runCli(worktree, ...command, "status", "tracking", "--json")).stdout);
  assert.equal(stale.tasks[0].state, "stale");
  assert.equal(await fs.readFile(mapPath, "utf8"), before);
});
