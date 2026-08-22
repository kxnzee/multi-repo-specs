#!/usr/bin/env node

/** @fileoverview Изолированный launcher зависимости CodeGraph Plugin Package. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import {
  installAgentIntegration,
  removeAgentIntegration,
} from "../lib/agent.js";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("@colbymchenry/codegraph/package.json"));
const entrypoint = path.join(packageRoot, "npm-shim.js");
const args = process.argv.slice(2);

if (args[0] === "agent" && ["install", "remove"].includes(args[1])) {
  const agentIndex = args.indexOf("--agent");
  const agentId = agentIndex === -1 ? undefined : args[agentIndex + 1];
  if (!agentId || args.length !== 4) {
    throw new Error("CodeGraph Agent lifecycle требует --agent <agent-id>");
  }
  if (args[1] === "install") await installAgentIntegration(agentId);
  else await removeAgentIntegration(agentId);
  console.log(`codegraph: agent ${agentId} ${args[1] === "install" ? "installed" : "removed"}`);
} else {
  const child = spawn(process.execPath, [entrypoint, ...args], {
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
}
