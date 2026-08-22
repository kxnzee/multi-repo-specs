/** @fileoverview Общие пути и зарезервированные имена Plugin subsystem. */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { DESCRIPTOR_FILES, SERVICE_PATHS } from "../config/constants.js";
import { RESERVED_TOP_LEVEL_TOKENS } from "../shared/cli-grammar.js";

export const DISTRIBUTION_PACKAGE_FILE = path.resolve(
  fileURLToPath(new URL("../../../package.json", import.meta.url)),
);
export const INSTALLED_PLUGIN_RELATIVE_ROOT = SERVICE_PATHS.pluginCache;
export const PLUGIN_DESCRIPTOR_FILE = DESCRIPTOR_FILES.plugin;
export const PLUGIN_INSTALLATION_FILE = "installation.json";
export const PLUGIN_PACKAGE_FILE = "package.json";
export const PLUGIN_PACKAGE_API_VERSION = 1;
export const RESERVED_PLUGIN_IDS = new Set(RESERVED_TOP_LEVEL_TOKENS);
