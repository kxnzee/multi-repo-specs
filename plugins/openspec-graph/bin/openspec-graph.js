#!/usr/bin/env node

/** @fileoverview Package-owned graph builder launcher. */

import process from "node:process";

import { buildOpenSpecGraph } from "../lib/builder.js";

/** Reads the value following a required CLI option. */
function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1) {
    throw new Error(`OPENSPEC_GRAPH_ARGUMENT_INVALID: ${name} is required`);
  }
  return args[index + 1];
}

try {
  const [operation, projectRoot = ".", ...args] = process.argv.slice(2);
  if (operation !== "build") {
    throw new Error(`OPENSPEC_GRAPH_OPERATION_UNSUPPORTED: ${operation ?? ""}`);
  }
  const storeId = option(args, "--store-id");
  const repositories = JSON.parse(option(args, "--repositories-json"));
  const graph = await buildOpenSpecGraph(projectRoot, { repositories, storeId });
  process.stdout.write(`${JSON.stringify(graph)}\n`);
} catch (error) {
  process.stderr.write(
    `openspec-graph: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
