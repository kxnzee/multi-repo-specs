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

test("runCommand redacts sensitive values from invocation and stderr", () => {
  const secret = "https://user:pass@example.test/repository.git";
  assert.throws(
    () => runCommand(
      process.execPath,
      ["-e", "console.error(process.argv[1]); process.exit(1)", secret],
      { sensitiveValues: [secret] },
    ),
    (error) => {
      assert.doesNotMatch(error.message, /user:pass/);
      assert.match(error.message, /<repository-url>/);
      return true;
    },
  );
});

test("runCommand terminates a process after timeout", () => {
  assert.throws(
    () => runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { timeout: 25 }),
    /terminated by|ETIMEDOUT|timed out/i,
  );
  assert.throws(() => runCommand(process.execPath, ["--version"], { timeout: 0 }), /положительным числом/);
});
