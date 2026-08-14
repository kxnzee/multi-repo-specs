/** @fileoverview Проверка кроссплатформенного запуска внешних команд. */

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import { runCommand } from "../src/internal/shared/command.js";

test("runCommand resolves the npm executable on every supported platform", async () => {
  // В Windows это npm.cmd, поэтому тест защищает именно cross-platform runner.
  assert.match(await runCommand("npm", ["--version"]), /^\d+\.\d+\.\d+/);
});

test("runCommand yields control while the subprocess is running", async () => {
  const execution = runCommand(
    process.execPath,
    ["-e", "setTimeout(() => process.stdout.write('done'), 100)"],
  );
  let completed = false;
  execution.then(() => {
    completed = true;
  });
  await waitForImmediate();
  assert.equal(completed, false);
  assert.equal(await execution, "done");
});

test("runCommand includes stderr from a failed process", async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", "console.error('failure-details'); process.exit(2)"]),
    /failure-details/,
  );
});

test("runCommand forwards stderr from a successful process without failing", async () => {
  const warnings = [];
  const output = await runCommand(
    process.execPath,
    ["-e", "console.error('config-warning'); process.stdout.write('ok')"],
    { onStderr: (message) => warnings.push(message) },
  );

  assert.equal(output, "ok");
  assert.deepEqual(warnings, ["config-warning"]);
});

test("runCommand passes an isolated environment override", async () => {
  assert.equal(
    await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env.OPENSPEC_ORCH_TEST_ENVIRONMENT ?? '')"],
      { environment: { OPENSPEC_ORCH_TEST_ENVIRONMENT: "expanded" } },
    ),
    "expanded",
  );
});

test("runCommand redacts sensitive values from invocation and stderr", async () => {
  const secret = "https://user:pass@example.test/repository.git";
  await assert.rejects(
    runCommand(
      process.execPath,
      ["-e", "console.error(process.argv[1]); process.exit(1)", secret],
      { sensitiveValues: [secret] },
    ),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("runCommand terminates a process after timeout", async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { timeout: 25 }),
  );
  await assert.rejects(runCommand(process.execPath, ["--version"], { timeout: 0 }));
});
