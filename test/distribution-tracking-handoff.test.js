/** @fileoverview Переносимый Change Tracking checkpoint между Git worktree. */
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
} from "../test-support/distribution-tracking.js";

test("candidate CLI resumes a checkpoint from a different worktree and protects against stale writers", async (t) => {
  const fixture = await prepareTracking(t);
  const { storeRoot, codeRoot, command, tasksPath, mapPath, registerCleanup } = fixture;
  await connectTracking(fixture);
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
