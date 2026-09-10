/** @fileoverview Change Tracking CLI/MCP smoke against the candidate distribution. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parse } from "yaml";

import { MCP_PATH, runCli, commitAll, distributionFixture } from "./helpers/distribution.js";

test("candidate distribution completes Change Tracking through public MCP", async (t) => {
  let { codeRoot, registerCleanup, storeRoot } = await distributionFixture(
    t,
    "openspec-orch-distribution-mcp-",
  );
  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(
    storeRoot,
    "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend",
  );
  await execa(
    "openspec",
    ["new", "change", "tracker-smoke", "--schema", "spec-driven"],
    { cwd: storeRoot },
  );
  const tasksPath = path.join(storeRoot, "openspec/changes/tracker-smoke/tasks.md");
  await fs.writeFile(tasksPath, "# Tasks\n\n- [ ] 1.1 Implement tracker smoke\n");
  await commitAll(storeRoot, "Plan tracker smoke");
  await fs.mkdir(path.join(codeRoot, "openspec"), { recursive: true });
  await fs.writeFile(path.join(codeRoot, "openspec/config.yaml"), "store: specs\n");
  await commitAll(codeRoot, "Connect OpenSpec Store");
  await fs.appendFile(path.join(codeRoot, ".gitignore"), "\n.worktrees/\n");
  await commitAll(codeRoot, "Ignore worktrees");
  const mainRoot = codeRoot;
  const worktree = path.join(codeRoot, ".worktrees", "attempt");
  await execa("git", ["worktree", "add", "-b", "attempt", worktree], { cwd: mainRoot });
  registerCleanup(() => execa("git", ["worktree", "remove", "--force", worktree], { cwd: mainRoot }));
  codeRoot = worktree;
  await fs.writeFile(path.join(codeRoot, "preparation.js"), "export const prepared = true;\n");
  await commitAll(codeRoot, "Prepare attempt worktree");
  const baseRevision = (await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_PATH],
    cwd: codeRoot,
    env: { ...process.env },
    stderr: "pipe",
  });
  const client = new Client({ name: "tracker-composition-smoke", version: "1.0.0" });
  registerCleanup(() => client.close());
  await client.connect(transport);
  const started = await client.callTool({
    name: "start_attempt",
    arguments: { change_id: "tracker-smoke", task_id: "1" },
  });
  assert.equal(JSON.parse(started.content[0].text).base_revision, baseRevision);
  await fs.writeFile(tasksPath, "# Tasks\n\n- [ ] 1.1 Changed task identity\n");
  await commitAll(storeRoot, "Revise planned task");
  const rejected = await client.callTool({ name: "start_attempt", arguments: { change_id: "tracker-smoke", task_id: "1" } });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /ATTEMPT_TASK_CHANGED/u);
  await assert.rejects(runCli(codeRoot, "plugin", "exec", "--repo", "specs", "change-tracking", "attempt", "start", "tracker-smoke", "1"), /ATTEMPT_TASK_CHANGED/u);
  await runCli(codeRoot, "plugin", "exec", "--repo", "specs", "change-tracking", "attempt", "cancel", "tracker-smoke", "1", "Task revised during planning");
  const status = await client.callTool({ name: "get_status", arguments: { change_id: "tracker-smoke" } });
  assert.equal(JSON.parse(status.content[0].text).tracking.cancelled.length, 1);
  await fs.writeFile(tasksPath, "# Tasks\n\n- [ ] 1.1 Implement tracker smoke\n");
  await commitAll(storeRoot, "Restore planned scope");
  const restarted = await client.callTool({ name: "start_attempt", arguments: { change_id: "tracker-smoke", task_id: "1" } });
  assert.equal(restarted.isError, undefined);


  await fs.writeFile(path.join(codeRoot, "index.js"), "export const ready = 'tracked';\n");
  await commitAll(codeRoot, "Implement tracker smoke");
  const implementationRevision = (
    await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })
  ).stdout;
  await fs.writeFile(tasksPath, "# Tasks\n\n- [x] 1.1 Implement tracker smoke\n");
  await assert.rejects(runCli(mainRoot, "plugin", "exec", "--repo", "specs", "change-tracking",
    "attempt", "complete", "tracker-smoke", "1"), /ATTEMPT_CHECKOUT_CHANGED/);
  const completed = await client.callTool({
    name: "complete_attempt",
    arguments: { change_id: "tracker-smoke", task_id: "1" },
  });
  assert.equal(JSON.parse(completed.content[0].text).attempt.implementation_revision,
    implementationRevision);
  const implementationMap = parse(await fs.readFile(
    path.join(storeRoot, "openspec/changes/tracker-smoke/implementation-map.yaml"),
    "utf8",
  ));
  assert.deepEqual(implementationMap.attempts.map((attempt) => ({
    repository: attempt.repository_id,
    task: attempt.task.id,
    base: attempt.base_revision,
    implementation: attempt.implementation_revision,
  })), [{
    repository: "frontend",
    task: "1",
    base: baseRevision,
    implementation: implementationRevision,
  }]);
});

test("candidate distribution completes Change Tracking through public CLI from a nested Code Repository", async (t) => {
  const { codeRoot, storeRoot } = await distributionFixture(
    t,
    "openspec-orch-distribution-tracking-cli-",
  );
  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(
    storeRoot,
    "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend",
  );
  await execa(
    "openspec",
    ["new", "change", "tracker-smoke", "--schema", "spec-driven"],
    { cwd: storeRoot },
  );
  const tasksPath = path.join(storeRoot, "openspec/changes/tracker-smoke/tasks.md");
  await fs.writeFile(tasksPath, "# Tasks\n\n- [ ] 1.1 Implement tracker smoke\n");
  await commitAll(storeRoot, "Plan tracker smoke");
  await fs.mkdir(path.join(codeRoot, "openspec"), { recursive: true });
  await fs.writeFile(path.join(codeRoot, "openspec/config.yaml"), "store: specs\n");
  await commitAll(codeRoot, "Connect OpenSpec Store");
  const baseRevision = (await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout;

  const nestedRoot = path.join(codeRoot, "src");
  await fs.mkdir(nestedRoot, { recursive: true });
  const command = ["plugin", "exec", "--repo", "specs", "change-tracking", "attempt"];
  await assert.rejects(runCli(storeRoot, ...command, "start", "tracker-smoke", "1"),
    /ATTEMPT_CONTEXT_INVALID/);
  await assert.rejects(runCli(nestedRoot, ...command, "start", "tracker-smoke", "1.1"),
    /ATTEMPT_TASK_NOT_FOUND/);
  await runCli(nestedRoot, ...command, "start", "tracker-smoke", "1");

  await fs.writeFile(path.join(codeRoot, "index.js"), "export const ready = 'tracked';\n");
  await commitAll(codeRoot, "Implement tracker smoke");
  const implementationRevision = (
    await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })
  ).stdout;
  await fs.writeFile(tasksPath, "# Tasks\n\n- [x] 1.1 Implement tracker smoke\n");
  await runCli(nestedRoot, ...command, "complete", "tracker-smoke", "1");
  const implementationMap = parse(await fs.readFile(
    path.join(storeRoot, "openspec/changes/tracker-smoke/implementation-map.yaml"),
    "utf8",
  ));
  assert.deepEqual(implementationMap.attempts.map((attempt) => ({
    repository: attempt.repository_id,
    task: attempt.task.id,
    base: attempt.base_revision,
    implementation: attempt.implementation_revision,
  })), [{
    repository: "frontend",
    task: "1",
    base: baseRevision,
    implementation: implementationRevision,
  }]);
});


test("candidate distribution publishes partial worktree implementation and resumes through CLI", async (t) => {
  const { codeRoot, registerCleanup, storeRoot } = await distributionFixture(t, "openspec-orch-handoff-");
  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(storeRoot, "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend");
  await execa("openspec", ["new", "change", "handoff", "--schema", "spec-driven"], { cwd: storeRoot });
  const tasksPath = path.join(storeRoot, "openspec/changes/handoff/tasks.md");
  const tasks = "# Tasks\n\n- [ ] 1.1 Implement handoff\n";
  await fs.writeFile(tasksPath, tasks);
  await fs.mkdir(path.join(codeRoot, "openspec"), { recursive: true });
  await fs.writeFile(path.join(codeRoot, "openspec/config.yaml"), "store: specs\n");
  await commitAll(codeRoot, "Connect Store");
  const mainHead = (await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout;
  const worktree = path.join(codeRoot, ".worktrees", "partial");
  await execa("git", ["worktree", "add", "-b", "partial", worktree], { cwd: codeRoot });
  registerCleanup(() => execa("git", ["worktree", "remove", "--force", worktree], { cwd: codeRoot }));
  await fs.writeFile(path.join(worktree, "partial.js"), "export const partial = true;\n");
  await commitAll(worktree, "Partial implementation");
  const sha = (await execa("git", ["rev-parse", "HEAD"], { cwd: worktree })).stdout;
  assert.notEqual(sha, mainHead);
  const client = new Client({ name: "partial-handoff", version: "1.0.0" });
  registerCleanup(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_PATH],
    cwd: worktree, env: { ...process.env }, stderr: "pipe" }));
  const input = { change_id: "handoff", task_id: "1", task_description: "1.1 Implement handoff",
    pull_request: "https://example.test/frontend/pull/42", commits: [sha],
    summary: "Partial implementation; tests pending", remaining: "Add tests", expected_version: 0 };
  const response = await client.callTool({ name: "record_implementation", arguments: input });
  assert.notEqual(response.isError, true, JSON.stringify(response.content));
  const duplicate = await client.callTool({ name: "record_implementation",
    arguments: { ...input, pull_request: `${input.pull_request}#discussion` } });
  assert.equal(duplicate.isError, true);
  assert.match(duplicate.content[0].text, /IMPLEMENTATION_CONFLICT/);
  assert.equal(JSON.parse(response.content[0].text).task_done, false);
  assert.equal(await fs.readFile(tasksPath, "utf8"), tasks);
  const localState = path.join(storeRoot, ".openspec-orch/plugins/change-tracking/state.json");
  await assert.rejects(fs.access(localState), { code: "ENOENT" });
  await client.close();

  // Другой процесс продолжает по переносимой карте, без локальной attempt и Store commit.
  const command = ["plugin", "exec", "--repo", "specs", "change-tracking"];
  let status = JSON.parse((await runCli(codeRoot, ...command, "status", "handoff")).stdout);
  assert.equal(status.implementations[0].remaining, "Add tests");
  assert.deepEqual(status.implementations[0].commits, [sha]);
  await fs.writeFile(tasksPath, tasks.replace("[ ]", "[x]"));
  const updated = JSON.parse((await runCli(codeRoot, ...command, "record", "handoff", "1",
    "--description", input.task_description, "--pr", input.pull_request, "--commits", sha,
    "--summary", "Implementation and tests done", "--remaining", "", "--version", "1")).stdout);
  assert.equal(updated.task_done, true);
  status = JSON.parse((await runCli(codeRoot, ...command, "status", "handoff")).stdout);
  assert.equal(status.implementations[0].task_state, "done");
  assert.equal(status.implementations[0].version, 2);
  assert.deepEqual(status.implementations[0].commits, [sha]);
  await assert.rejects(fs.access(localState), { code: "ENOENT" });
  // Старый повреждённый storage не скрывает карту и не исправляется молча.
  await fs.mkdir(path.dirname(localState), { recursive: true });
  await fs.writeFile(localState, "{broken");
  await fs.writeFile(tasksPath, "# Tasks\n\n- [x] 1.1 Implement handoff safely\n- [ ] 1.2 Untracked work\n");
  status = JSON.parse((await runCli(codeRoot, ...command, "status", "handoff")).stdout);
  assert.equal(status.legacy_error.code, "PLUGIN_STORAGE_CORRUPTED");
  assert.equal(status.tasks.length, 2);
  assert.equal(status.implementations[0].task_state, "changed_or_missing");
  const rebound = JSON.parse((await runCli(codeRoot, ...command, "record", "handoff", "1",
    "--description", "1.1 Implement handoff safely", "--pr", input.pull_request,
    "--commits", sha, "--summary", "Confirmed revised task", "--remaining", "",
    "--version", "2", "--previous-task", "1")).stdout);
  assert.equal(rebound.implementation.version, 3);
  status = JSON.parse((await runCli(codeRoot, ...command, "status", "handoff")).stdout);
  assert.equal(status.implementations.length, 1);
  assert.equal(status.implementations[0].task_done, true);
  assert.deepEqual(status.tasks[1].implementations, []);
  assert.equal(await fs.readFile(localState, "utf8"), "{broken");
  assert.equal((await execa("git", ["rev-parse", "HEAD"], { cwd: codeRoot })).stdout, mainHead);
  const record = (pr, version, summary) => runCli(codeRoot, ...command, "record", "handoff", "1",
    "--description", "1.1 Implement handoff safely", "--pr", pr, "--commits", sha,
    "--summary", summary, "--remaining", "", "--version", String(version));
  const raced = await Promise.allSettled([
    record(input.pull_request, 3, "Contributor A"), record(input.pull_request, 3, "Contributor B"),
  ]);
  assert.equal(raced.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(raced.find(({ status }) => status === "rejected").reason.message, /IMPLEMENTATION_CONFLICT/);
  await Promise.all([
    record("https://example.test/frontend/pull/43", 0, "Additional work"),
    record("https://example.test/frontend/pull/44", 0, "Other work"),
  ]);
  status = JSON.parse((await runCli(codeRoot, ...command, "status", "handoff")).stdout);
  assert.deepEqual(status.implementations.map(({ pull_request }) => pull_request).sort(), [
    input.pull_request, "https://example.test/frontend/pull/43", "https://example.test/frontend/pull/44",
  ]);
  assert.equal(status.implementations.find(({ pull_request }) => pull_request === input.pull_request).version, 4);

});
