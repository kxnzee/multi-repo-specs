/** @fileoverview Публичный facade Plugin subsystem. */

export { discoverPlugins } from "./catalog.js";
export { createPluginClient, PluginClient } from "./plugin-client.js";
export { createPluginModel, PluginModel } from "./model.js";
export { registerPluginPackage } from "./scaffold.js";
export {
  connectPlugin,
  connectPluginRepositories,
  disconnectPlugin,
  initializePlugins,
  readPluginStatus,
  removePlugin,
  runPluginCommand,
  syncPlugin,
} from "./project.js";
export { parseNativePluginArguments, routeNativePluginCommand } from "./router.js";
