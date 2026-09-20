/** @fileoverview Изолированный import локального Plugin для явного validate --load. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

const root = process.argv[2];
const packageManifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const { default: plugin } = await import(pathToFileURL(path.join(root, packageManifest.openspecOrchestrator.plugin)).href);
assertPluginContract({ plugin, packageManifest });
process.stdout.write("\nOPENSPEC_PLUGIN_CONTRACT_VERIFIED\n");
