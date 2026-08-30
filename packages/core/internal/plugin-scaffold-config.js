/** @fileoverview Core-owned profiles and defaults for Plugin scaffolding. */

export const PLUGIN_SCAFFOLD_PROFILE = Object.freeze({
  commands: "commands",
  native: "native",
  repository: "repository",
});

export const PLUGIN_SCAFFOLD_CONFIG = Object.freeze({
  defaultProfile: PLUGIN_SCAFFOLD_PROFILE.commands,
  profiles: Object.freeze(Object.values(PLUGIN_SCAFFOLD_PROFILE)),
});
