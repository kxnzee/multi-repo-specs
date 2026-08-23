#!/usr/bin/env node

/** @fileoverview Публичная точка входа OpenSpec Orchestrator CLI. */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MINIMUM_NODE_VERSION = "20.19.0";
const require = createRequire(import.meta.url);

/** Проверяет bootstrap runtime до загрузки Core и Plugins. */
function assertNodeVersion(version = process.versions.node) {
  const current = version.split(".").map(Number);
  const supported = current.length === 3 && current.every(Number.isInteger) && (
    current[0] > 20 || (current[0] === 20 && current[1] >= 19)
  );
  if (!supported) {
    throw new Error(
      `OpenSpec Orchestrator требует Node.js ${MINIMUM_NODE_VERSION} или новее; ` +
        `текущая версия: ${version}`,
    );
  }
}

/** Разрешает установленный Plugin package после проверки runtime. */
async function resolvePluginPackage(packageName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  return {
    manifest: JSON.parse(await fs.readFile(manifestPath, "utf8")),
    root: path.dirname(manifestPath),
  };
}

const templateRoot = fileURLToPath(new URL("../templates/base/", import.meta.url));

try {
  assertNodeVersion();
  const [{ BundledPluginPackage, BundledPluginProvider, createCandidateProgram },
    changeTracking, codeGraph] = await Promise.all([
    import("@openspec-orch/core"),
    resolvePluginPackage("@openspec-orch/plugin-change-tracking"),
    resolvePluginPackage("@openspec-orch/plugin-codegraph"),
  ]);
  const bundledProvider = new BundledPluginProvider([
    new BundledPluginPackage({
      id: "change-tracking",
      name: "Change Tracking",
      packageName: changeTracking.manifest.name,
      packageRoot: changeTracking.root,
      version: changeTracking.manifest.version,
    }),
    new BundledPluginPackage({
      id: "codegraph",
      name: "CodeGraph",
      packageName: codeGraph.manifest.name,
      packageRoot: codeGraph.root,
      version: codeGraph.manifest.version,
    }),
  ]);
  const program = await createCandidateProgram({
    bundledProvider,
    rootCommands: new Map([
      ["change-tracking", ["assign", "status", "record", "verify"]],
    ]),
    templateRoot,
  });
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync(process.argv);
} catch (error) {
  if (typeof error?.code === "string" && error.code.startsWith("commander.")) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    console.error(`openspec-orch: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
