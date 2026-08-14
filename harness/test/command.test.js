/** @fileoverview Проверка кроссплатформенного запуска внешних команд. */

import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import { runCommand } from "../shared/command.js";

test("runCommand resolves the npm executable on every supported platform", () => {
  // В Windows это npm.cmd, поэтому тест защищает именно cross-platform runner.
  assert.match(runCommand("npm", ["--version"]), /^\d+\.\d+\.\d+/);
});

test("runCommand includes stderr from a failed process", () => {
  assert.throws(
    () => runCommand(process.execPath, ["-e", "console.error('failure-details'); process.exit(2)"]),
    /failure-details/,
  );
});

test("runCommand forwards stderr from a successful process without failing", () => {
  const warnings = [];
  const output = runCommand(
    process.execPath,
    ["-e", "console.error('config-warning'); process.stdout.write('ok')"],
    { onStderr: (message) => warnings.push(message) },
  );

  assert.equal(output, "ok");
  assert.deepEqual(warnings, ["config-warning"]);
});

test("runCommand passes an isolated environment override", () => {
  assert.equal(
    runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env.OPENSPEC_ORCH_TEST_ENVIRONMENT ?? '')"],
      { environment: { OPENSPEC_ORCH_TEST_ENVIRONMENT: "expanded" } },
    ),
    "expanded",
  );
});

test("runCommand redacts sensitive values from invocation and stderr", () => {
  const secret = "https://user:pass@example.test/repository.git";
  assert.throws(
    () => runCommand(
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

test("runCommand terminates a process after timeout", () => {
  assert.throws(
    () => runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { timeout: 25 }),
  );
  assert.throws(() => runCommand(process.execPath, ["--version"], { timeout: 0 }));
});
