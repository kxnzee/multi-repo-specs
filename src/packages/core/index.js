/** @fileoverview Публичная граница OpenSpec Orchestrator Core. */

// `internal/index.js` — явная карта реализаций, которые составляют public Core API.
export * from "./internal/index.js";

import { PluginPlatform } from "./internal/index.js";

/** Создаёт candidate CLI с уже перенесёнными Core operations. */
export async function createCandidateProgram({
  bundledAgentProvider,
  bundledExtensionProvider,
  bundledTemplateProvider,
  bundledProvider,
  loadedPlugins,
  pluginCommandOptions,
  pluginContextFactory,
  pluginManagerService,
  start,
  storeProjectService,
  ...options
} = {}) {
  const platform = await PluginPlatform.create({
    bundledAgentProvider,
    bundledExtensionProvider,
    bundledTemplateProvider,
    bundledProvider,
    contextFactory: pluginContextFactory,
    loadedPlugins,
    managerService: pluginManagerService,
    pluginCommandOptions,
    start,
    storeProjectService,
  });
  return platform.createProgram(options);
}
