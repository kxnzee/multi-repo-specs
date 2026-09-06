/** @fileoverview Checks the installed development toolchain without modifying user configuration. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

/** Runs one bounded, read-only tool probe without shell-specific command wrappers. */
function probe(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  }).trim();
}

try {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const expectedOpenSpec = manifest.devDependencies["@fission-ai/openspec"];
  const openSpecRoot = path.join(root, "node_modules", "@fission-ai", "openspec");
  const openSpec = JSON.parse(readFileSync(path.join(openSpecRoot, "package.json"), "utf8"));
  if (openSpec.version !== expectedOpenSpec) {
    throw new Error(`OpenSpec ${openSpec.version}; expected ${expectedOpenSpec}. Run npm ci.`);
  }
  // The public entrypoint checks the supported Node version and workspace imports.
  const orchestrator = probe(process.execPath, [path.join(root, "bin", "openspec-orch.js"), "--version"]);
  if (orchestrator !== manifest.version) throw new Error("Unexpected Orchestrator version.");
  console.log(`Node ${process.versions.node} (supported: ${manifest.engines.node})`);
  console.log(probe("git", ["--version"]));
  const openSpecVersion = probe(process.execPath, [path.join(openSpecRoot, openSpec.bin.openspec), "--version"]);
  if (openSpecVersion !== expectedOpenSpec) throw new Error("Unexpected OpenSpec CLI version.");
  console.log(`OpenSpec ${openSpecVersion} (checkout-local)`);
  console.log(`Orchestrator ${orchestrator}: workspace imports ready`);
} catch (error) {
  console.error(`Development environment is not ready: ${error.stderr?.toString().trim() || error.message}`);
  console.error("Use the supported Node version, install Git, and run npm ci in the repository root.");
  process.exitCode = 1;
}
