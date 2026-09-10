/** @fileoverview Thin mapper for GigaCode's Qwen-compatible Extension lifecycle. */

import { createExtensionCliLifecycle } from "../extension-cli.js";
import { AGENT_ADAPTER_CONFIG } from "../config.js";

export default createExtensionCliLifecycle(AGENT_ADAPTER_CONFIG.gigacode);
