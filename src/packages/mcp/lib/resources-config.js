/** @fileoverview MCP-owned policy for Store resources exposed read-only. */

export const MCP_RESOURCE_CONFIG = Object.freeze({
  rootFiles: Object.freeze([
    "openspec-orch.yaml", "openspec/config.yaml", "STORE.md",
  ]),
  staticTrees: Object.freeze([
    Object.freeze({ root: "openspec/context", suffixes: new Set([".md", ".yaml", ".yml"]) }),
    Object.freeze({ root: "openspec/specs", names: new Set(["spec.md"]) }),
  ]),
  builtinSchemaOutputs: Object.freeze({
    "spec-driven": Object.freeze(["proposal.md", "specs/**/*.md", "design.md", "tasks.md"]),
  }),
});
