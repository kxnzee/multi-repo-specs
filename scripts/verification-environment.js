/** @fileoverview Reproducible process environment for repository verification only. */

import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
process.env.PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`;
process.env.OPENSPEC_TELEMETRY = "0";
process.env.DO_NOT_TRACK = "1";
process.env.OPENSPEC_NO_UPDATE_CHECK = "1";
process.env.NPM_CONFIG_UPDATE_NOTIFIER = "false";
