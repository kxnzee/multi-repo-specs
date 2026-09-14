#!/usr/bin/env node

/** @fileoverview Thin public stdio adapter for the Orchestrator Agent API. */

import { runPublicEntrypoint } from "./internal/entrypoint.js";
import { runMcp } from "./internal/mcp-entrypoint.js";

await runPublicEntrypoint({ name: "openspec-orch-mcp", run: runMcp });
