/** @fileoverview Статичные значения публичного Plugin-контракта. */

export const PLUGIN_API_VERSION = 1;

export const REPOSITORY_ROLE = Object.freeze({
  code: "code",
  store: "store",
});

export const COMMAND_SCOPE = Object.freeze({
  current: "current",
  store: "store",
});

export const COMMAND_CONTEXT = Object.freeze({
  defaultScope: COMMAND_SCOPE.current,
  keys: Object.freeze(["scope", "requireBinding"]),
  scopes: Object.freeze(Object.values(COMMAND_SCOPE)),
});

export const COMMAND_PATTERNS = Object.freeze({
  definitionName: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?=$|\s)/,
  name: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  optionFlags: /^(?:-[a-zA-Z],\s*)?--[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\s+(?:<[^>]+>|\[[^\]]+\]))?$/,
});

export const PLUGIN_PATTERNS = Object.freeze({
  exactSemanticVersion: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  id: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
});

export const PLUGIN_API_METHODS = Object.freeze([
  "supportsRole",
  "assertSupports",
  "hasRepositoryContribution",
  "connect",
  "status",
  "canSync",
  "sync",
  "canExec",
  "exec",
  "hasExtensionContribution",
  "extensions",
  "hasCommandContribution",
  "registerCommands",
]);
