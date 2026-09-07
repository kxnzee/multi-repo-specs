/** @fileoverview Regression checks for shipped agent task isolation and worktree closeout. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import helpers from "../extensions/superpowers/skills/subagent-driven-development/scripts/task-context.cjs";

const SCRIPT = fileURLToPath(new URL(
  "../extensions/superpowers/skills/subagent-driven-development/scripts/task-context.cjs", import.meta.url,
));
const FINISH = new URL("../extensions/superpowers/skills/finishing-a-development-branch/SKILL.md", import.meta.url);

/** Runs Git against an isolated fixture. */
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Creates a temporary repository with one commit and deterministic identity. */
async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--allow-empty", "-m", "baseline");
  return root;
}

const PLAN = [
  "# Plan", "## Repository: `frontend`", "### Task 1: frontend",
  "frontend result", "#### Details", "```markdown", "### Task 1: example", "```",
  "~~~markdown", "## Repository: `example`", "~~~",
  "## Repository: `backend`", "### Task 1: backend", "backend result",
  "### Task 2: backend second", "second result", "## Cross-repository convergence", "convergence",
].join("\n");

test("task extraction requires an unambiguous repository and respects sections and fences", () => {
  assert.throws(() => helpers.extractTask(PLAN, "1"), /found 2/u);
  const frontend = helpers.extractTask(PLAN, "1", "frontend");
  assert.match(frontend, /frontend result/u);
  assert.match(frontend, /Task 1: example/u);
  assert.doesNotMatch(frontend, /backend|convergence/u);
  const backend = helpers.extractTask(PLAN, "1", "backend");
  assert.match(backend, /backend result/u);
  assert.doesNotMatch(backend, /frontend|second result|convergence/u);
  assert.throws(() => helpers.extractTask(PLAN, "1", "missing"), /found 0/u);
  assert.throws(() => helpers.extractTask(PLAN, "1.*"), /positive integer/u);
  assert.equal(helpers.extractTask("### Task 1: one\nbody\n## Summary\nend", "1"), "### Task 1: one\nbody\n");
});

test("ambiguous task dispatch leaves an existing brief intact", async (t) => {
  const root = await repository(t);
  const plan = path.join(root, "plan.md");
  const output = path.join(root, "brief.md");
  await fs.writeFile(plan, PLAN);
  await fs.writeFile(output, "previous verified brief");
  const result = spawnSync(process.execPath, [SCRIPT, "brief", plan, "1", output], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /found 2/u);
  assert.equal(await fs.readFile(output, "utf8"), "previous verified brief");
  execFileSync(process.execPath, [SCRIPT, "brief", plan, "1", output, "--repo", "backend"]);
  assert.equal(await fs.readFile(output, "utf8"), helpers.extractTask(PLAN, "1", "backend"));
});

test("progress workspace isolates plan identity, contents and branch but survives implementation commits", async (t) => {
  const root = await repository(t);
  const plan = path.join(root, "plan.md");
  const otherPlan = path.join(root, "other-change.md");
  await fs.writeFile(plan, PLAN);
  await fs.writeFile(otherPlan, PLAN);
  const initial = helpers.workspace(plan, root);
  await fs.writeFile(path.join(initial, "progress.md"), "Task 1: complete");
  assert.equal(helpers.workspace(plan, root), initial);
  assert.equal(helpers.workspace("plan.md", root), initial);
  assert.notEqual(helpers.workspace(otherPlan, root), initial);
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--allow-empty", "-m", "implementation");
  assert.equal(helpers.workspace(plan, root), initial);
  git(root, "switch", "-c", "another-change");
  const newBranch = helpers.workspace(plan, root);
  assert.notEqual(newBranch, initial);
  await assert.rejects(fs.access(path.join(newBranch, "progress.md")), { code: "ENOENT" });
  await fs.writeFile(plan, PLAN + "\nUpdated requirement");
  assert.notEqual(helpers.workspace(plan, root), newBranch);
  git(root, "check-ignore", "--quiet", path.join(initial, "progress.md"));
});

test("closeout retains the original worktree identity after switching to the main checkout", async (t) => {
  const instructions = await fs.readFile(FINISH, "utf8");
  assert.equal([...instructions.matchAll(/FINISH_WORKTREE_PATH=\$\(git rev-parse --show-toplevel\)/gu)].length, 1);
  assert.match(instructions, /git worktree remove "\$FINISH_WORKTREE_PATH"/u);
  const root = await repository(t);
  const worktree = path.join(root, ".worktrees", "feature");
  git(root, "worktree", "add", worktree, "-b", "feature");
  const captured = git(worktree, "rev-parse", "--show-toplevel");
  const mainRoot = git(root, "rev-parse", "--show-toplevel");
  assert.notEqual(captured, mainRoot);
  git(mainRoot, "worktree", "remove", captured);
  git(mainRoot, "branch", "-d", "feature");
  await assert.rejects(fs.access(worktree), { code: "ENOENT" });
  assert.equal(git(root, "branch", "--list", "feature"), "");
});
