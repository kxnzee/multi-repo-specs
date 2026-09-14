/** @fileoverview Canonical configuration for the published Orchestrator distribution. */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PACKAGE_MANIFEST = require("../../../package.json");

export const MINIMUM_NODE_VERSION = PACKAGE_MANIFEST.engines.node.replace(/^>=/u, "");
export const MINIMUM_NODE_PARTS = Object.freeze(MINIMUM_NODE_VERSION.split(".").map(Number));

export const DISTRIBUTION_CONFIG = Object.freeze({
  defaultTemplateId: PACKAGE_MANIFEST.openspecOrchestrator.defaultTemplateId,
  plugins: Object.freeze(PACKAGE_MANIFEST.openspecOrchestrator.bundledPlugins.map((plugin) => (
    Object.freeze({ ...plugin })
  ))),
  version: PACKAGE_MANIFEST.version,
});

export const BUNDLED_ROOTS = Object.freeze({
  agents: fileURLToPath(new URL("../../agents/", import.meta.url)),
  extensions: fileURLToPath(new URL("../../../extensions/", import.meta.url)),
  templates: fileURLToPath(new URL("../../../templates/", import.meta.url)),
});

export const AGENT_GATEWAY_EXTENSION_ID = "orchestrator-agent";
