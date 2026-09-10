#!/usr/bin/env node

/** @fileoverview Thin public OpenSpec Orchestrator CLI adapter. */

import { runCli } from "./internal/cli-runtime.js";
import { runPublicEntrypoint } from "./internal/entrypoint.js";

await runPublicEntrypoint({ name: "openspec-orch", run: runCli, commander: true });
