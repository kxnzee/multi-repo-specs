/** @fileoverview Единый registry занятых top-level tokens публичного CLI. */

export const TOP_LEVEL_COMMANDS = Object.freeze({
  init: "init",
  connect: "connect",
  plugin: "plugin",
  repository: "repository",
  assign: "assign",
  status: "status",
  record: "record",
  verify: "verify",
});

export const RESERVED_TOP_LEVEL_TOKENS = Object.freeze([
  ...Object.values(TOP_LEVEL_COMMANDS),
  "help",
]);
