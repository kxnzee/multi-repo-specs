/** @fileoverview Настоящие Git, OpenSpec, CLI/MCP и переносимый checkpoint установленного кандидата. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { execa } from "execa";
import { parse } from "yaml";
import { runCli, commitAll } from "../test-support/distribution.js";
import {
  connectTracking,
  prepareTracking,
  trackingClientFor,
} from "../test-support/distribution-tracking.js";

test("candidate MCP hides disconnected tools, records automatic revisions and rejects calls after disconnect", async (t) => {
  const fixture = await prepareTracking(t);
  const { storeRoot, codeRoot, tasksPath, mapPath } = fixture;
  const client = await trackingClientFor(fixture, codeRoot);
  const args = { change_id: "tracking", task_id: "1" };
  assert.equal((await client.listTools()).tools.some(({ name }) => name === "tracking_start"), false);
  assert.equal((await client.callTool({ name: "tracking_start", arguments: args })).isError, true);
  await connectTracking(fixture);
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
  const fixture = await prepareTracking(t, true);
  await connectTracking(fixture);
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
  const client = await trackingClientFor(fixture, storeRoot);
  const mcp = await client.callTool({ name: "tracking_status", arguments: { all: true } });
  assert.notEqual(mcp.isError, true, JSON.stringify(mcp));
  assert.deepEqual(JSON.parse(mcp.content[0].text).changes, overview.changes);
  assert.equal((await runCli(storeRoot, ...command, "status", "--all")).stdout.trim().split("\n").length, 2);
  await assert.rejects(runCli(codeRoot, ...command, "status", "tracking", "--all"), /TRACKING_INPUT_INVALID/);
  await assert.rejects(runCli(codeRoot, ...command, "status", "tracking", "--diff"), /TRACKING_INPUT_INVALID/);
  assert.equal(await fs.readFile(mapPath, "utf8"), before);
});
