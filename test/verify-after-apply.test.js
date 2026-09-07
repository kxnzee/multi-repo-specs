/** @fileoverview Real OpenSpec routing for bundled post-implementation Verify artifacts. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { RepositoryOpenSpec } from "@openspec-orch/core";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OPEN_SPEC = path.join(ROOT, "node_modules/@fission-ai/openspec/bin/openspec.js");
const execute = promisify(execFile);

for (const schema of ["spec-driven-extended", "superspec-multirepo"]) {
  test(`${schema}: real OpenSpec routes Planning through Apply before Verify`, async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "verify-after-apply-"));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const root = await fs.realpath(temporary);
    await fs.cp(path.join(ROOT, "templates/default/openspec"), path.join(root, "openspec"), {
      recursive: true,
    });
    const change = path.join(root, "openspec/changes/verify-order");
    await fs.mkdir(path.join(change, "specs/example"), { recursive: true });
    await fs.writeFile(path.join(change, ".openspec.yaml"), `schema: ${schema}\n`);
    // Content fixtures establish artifact availability, not real implementation evidence.
    for (const file of ["intake.md", "brainstorm.md", "proposal.md", "design.md", "specs/example/spec.md"]) {
      await fs.writeFile(path.join(change, file), "# Planning fixture\n");
    }
    const application = new RepositoryOpenSpec({ root }, {
      cwd: root,
      async run(executable, args) {
        assert.equal(executable, "openspec");
        const { stdout } = await execute(process.execPath, [OPEN_SPEC, ...args], {
          cwd: root,
          env: { ...process.env, XDG_CONFIG_HOME: path.join(root, "config") },
          timeout: 30000,
        });
        return stdout;
      },
    });
    const tasks = path.join(change, "tasks.md");
    const verify = path.join(change, "verify.md");
    /** Changes only tracked progress to exercise routing across the Apply boundary. */
    const writeTasks = (first, second) => fs.writeFile(tasks,
      `## 1. Example\n- [${first}] 1.1 Implement behavior and check it\n` +
      `- [${second}] 1.2 Check integration\n`);

    await writeTasks(" ", " ");
    if (schema === "superspec-multirepo") {
      const beforePlan = await application.nextAction("verify-order");
      assert.equal(beforePlan.action, "prepare_artifact");
      assert.equal(beforePlan.artifact, "plan");
      await fs.writeFile(path.join(change, "plan.md"), "# Accepted execution plan fixture\n");
    }
    const status = await application.changeStatus("verify-order");
    assert.equal(status.artifacts.find(({ id }) => id === "verify").status, "ready");
    assert.equal((await application.nextAction("verify-order")).action, "apply_change");

    const planning = await application.artifactInstructions(
      "verify-order", schema === "superspec-multirepo" ? "plan" : "tasks",
    );
    const apply = await application.artifactInstructions("verify-order", "apply");
    assert.deepEqual(apply.tasks.map(({ id, description }) => ({ id, description })), [
      { id: "1", description: "1.1 Implement behavior and check it" },
      { id: "2", description: "1.2 Check integration" },
    ]);
    const verification = await application.artifactInstructions("verify-order", "verify");
    assert.match(planning.instruction, /refresh get_next_action/u);
    assert.match(verification.instruction, /Before creating or updating verify\.md/u);
    assert.match(verification.context, /Не создавай verify\.md заранее/u);

    await writeTasks("x", " ");
    assert.equal((await application.nextAction("verify-order")).action, "apply_change");
    await fs.access(verify).then(() => assert.fail("routing must not create Verify"),
      (error) => assert.equal(error.code, "ENOENT"));

    await writeTasks("x", "x");
    const complete = await application.nextAction("verify-order");
    assert.equal(complete.action, "prepare_artifact");
    assert.equal(complete.artifact, "verify");

    const previousVerify = "# Existing Verify\nHuman decision: PENDING\n";
    await fs.writeFile(verify, previousVerify);
    await writeTasks("x", " ");
    assert.equal((await application.nextAction("verify-order")).action, "apply_change");
    assert.equal(await fs.readFile(verify, "utf8"), previousVerify);

    await fs.writeFile(tasks, "# No tracked tasks\n");
    assert.equal((await application.nextAction("verify-order")).action, "consult_change_context");
  });
}
