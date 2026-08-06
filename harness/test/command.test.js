import assert from "node:assert/strict";
import test from "node:test";

import { runCommand } from "../shared/command.js";

test("runCommand resolves the npm executable on every supported platform", () => {
  // В Windows это npm.cmd, поэтому тест защищает именно cross-platform runner.
  assert.match(runCommand("npm", ["--version"]), /^\d+\.\d+\.\d+/);
});
