/** @fileoverview Runs node --test over explicit test directories without shell globs. */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const COVERAGE_FLAG = "--coverage";

/** Returns sorted top-level *.test.js files for every requested directory. */
async function discoverTests(directories) {
  const tests = [];
  for (const directory of directories) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isFile() && entry.name.endsWith(".test.js")) tests.push(path.join(directory, entry.name));
    }
  }
  return tests;
}

const args = process.argv.slice(2);
const coverage = args.includes(COVERAGE_FLAG);
const directories = args.filter((argument) => argument !== COVERAGE_FLAG);
if (directories.length === 0) {
  throw new Error("TEST_DIRECTORIES_EMPTY: укажите хотя бы один каталог с тестами");
}

const root = process.cwd();
const tests = await discoverTests(directories);
if (tests.length === 0) throw new Error(`TEST_FILES_EMPTY: ${directories.join(", ")}`);

const child = spawn(
  process.execPath,
  [
    ...(coverage ? ["--experimental-test-coverage"] : []),
    "--test",
    "--test-concurrency=1",
    ...tests.map((file) => path.relative(root, file)),
  ],
  { cwd: root, stdio: "inherit" },
);
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
