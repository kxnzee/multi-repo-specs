/** @fileoverview Публичный фасад Plugin SDK. */

export { collectValues, singleValue } from "./internal/cli-values.js";
export {
  COMMAND_CONTEXT,
  COMMAND_PATTERNS,
  COMMAND_SCOPE,
  PLUGIN_API_METHODS,
  PLUGIN_API_VERSION,
  PLUGIN_PATTERNS,
  REPOSITORY_ROLE,
} from "./internal/constants.js";
export { Extension, defineExtension } from "./internal/extension.js";
export { Plugin, definePlugin } from "./internal/plugin.js";
export { PluginPackage } from "./internal/plugin-package.js";
export { CliProgressRenderer, createCliProgress } from "./internal/progress.js";
