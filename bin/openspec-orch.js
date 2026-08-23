#!/usr/bin/env node

/** @fileoverview Непубличная точка входа candidate CLI на время миграции. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BundledPluginPackage,
  BundledPluginProvider,
  createCandidateProgram,
} from "../packages/core/index.js";
import changeTrackingPackage from "../plugins/change-tracking/package.json" with { type: "json" };

const templateRoot = fileURLToPath(new URL("../templates/base/", import.meta.url));
const changeTrackingRoot = fileURLToPath(new URL("../plugins/change-tracking/", import.meta.url));
const bundledProvider = new BundledPluginProvider([new BundledPluginPackage({
  id: "change-tracking",
  name: "Change Tracking",
  packageName: changeTrackingPackage.name,
  packageRoot: changeTrackingRoot,
  version: changeTrackingPackage.version,
})]);
const rootCommands = new Map([
  ["change-tracking", ["assign", "status", "record", "verify"]],
]);

const program = await createCandidateProgram({ bundledProvider, rootCommands, templateRoot });
await program.parseAsync(process.argv);
