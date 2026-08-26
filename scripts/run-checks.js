/** @fileoverview Discovers one non-code check suite across root and workspace packages. */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const SUITE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WORKSPACE_GROUPS = Object.freeze(["packages", "plugins"]);

/** Returns sorted test files below an optional suite directory. */
async function discoverTests(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const tests = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...await discoverTests(target));
    else if (entry.isFile() && entry.name.endsWith(".test.js")) tests.push(target);
  }
  return tests;
}

/** Returns every conventional checks/<suite> root in the monorepo. */
async function suiteRoots(root, suite) {
  const roots = [path.join(root, "checks", suite)];
  for (const group of WORKSPACE_GROUPS) {
    const groupRoot = path.join(root, group);
    let packages;
    try {
      packages = await fs.readdir(groupRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of packages.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) roots.push(path.join(groupRoot, entry.name, "checks", suite));
    }
  }
  return roots;
}

const [suite, ...unexpected] = process.argv.slice(2);
if (!suite || unexpected.length > 0 || !SUITE_PATTERN.test(suite)) {
  throw new Error("CHECK_SUITE_INVALID: укажите один suite в lowercase kebab-case");
}

const root = process.cwd();
const tests = (await Promise.all(
  (await suiteRoots(root, suite)).map((directory) => discoverTests(directory)),
)).flat();
if (tests.length === 0) throw new Error(`CHECK_SUITE_EMPTY: ${suite}`);

const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...tests.map((file) => path.relative(root, file))],
  { cwd: root, stdio: "inherit" },
);
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
