/** @fileoverview Thin mapper for the native Claude Plugin lifecycle. */

import { createClaudePluginLifecycle } from "../claude-plugin.js";
import { AGENT_ADAPTER_CONFIG } from "../config.js";

export default createClaudePluginLifecycle(AGENT_ADAPTER_CONFIG.claude);
