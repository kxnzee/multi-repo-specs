#!/usr/bin/env node

/** @fileoverview Точка входа OpenSpec Orchestrator CLI. */

import process from "node:process";

const MINIMUM_NODE = Object.freeze({ major: 20, minor: 19, patch: 0 });
const currentNode = process.versions.node.split(".").map(Number);
const supported = currentNode[0] > MINIMUM_NODE.major || (
  currentNode[0] === MINIMUM_NODE.major &&
  (
    currentNode[1] > MINIMUM_NODE.minor ||
    (currentNode[1] === MINIMUM_NODE.minor && currentNode[2] >= MINIMUM_NODE.patch)
  )
);

if (!supported) {
  console.error(
    `OpenSpec Orchestrator требует Node.js 20.19.0 или новее; ` +
      `текущая версия: ${process.versions.node}`,
  );
  process.exitCode = 1;
} else {
  const { runCli } = await import("../cli/index.js");
  await runCli();
}
