#!/usr/bin/env node

/** @fileoverview Изолированный launcher зависимости CodeGraph Plugin Package. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("@colbymchenry/codegraph/package.json"));
const entrypoint = path.join(packageRoot, "npm-shim.js");
const child = spawn(process.execPath, [entrypoint, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`CodeGraph Plugin runtime не запущен: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
