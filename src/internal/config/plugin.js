/** @fileoverview Project-config contract для Plugin IDs и Repository bindings. */

import * as z from "zod";

import { CONTRACT_PATTERNS } from "./constants.js";

export const PLUGIN_ID_SCHEMA = z.string().regex(
  CONTRACT_PATTERNS.id,
  "должен быть в lowercase kebab-case",
);

export const PLUGIN_IDS_SCHEMA = z.array(PLUGIN_ID_SCHEMA).default([]);

/** Проверяет уникальность Plugin ID и repository bindings. */
export function assertPluginBindings(plugins, repositories) {
  if (new Set(plugins).size !== plugins.length) {
    throw new Error("CONFIG_INVALID: plugins содержит повторяющийся plugin-id");
  }
  const knownPlugins = new Set(plugins);
  for (const repository of repositories) {
    if (new Set(repository.plugins).size !== repository.plugins.length) {
      throw new Error(
        `CONFIG_INVALID: repository-id ${repository.id} содержит повторяющийся plugin-id`,
      );
    }
    for (const pluginId of repository.plugins) {
      if (!knownPlugins.has(pluginId)) {
        throw new Error(
          `CONFIG_INVALID: repository-id ${repository.id} ссылается на необъявленный plugin-id ${pluginId}`,
        );
      }
    }
  }
}
