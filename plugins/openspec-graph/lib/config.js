/** @fileoverview Package-owned OpenSpec Graph defaults and presentation config. */

export const OPEN_SPEC_GRAPH_CONFIG = Object.freeze({
  files: Object.freeze({ operationHeadings: "openspec-graph.yaml" }),
  lifecycle: Object.freeze({
    mode: "compile_on_demand",
    command: "openspec-orch graph inspect",
  }),
  markers: Object.freeze({
    error: "[✗]",
    ok: "[✓]",
    warning: "[!]",
  }),
  operationHeadings: Object.freeze({
    ADDED: "## ADDED Requirements",
    MODIFIED: "## MODIFIED Requirements",
    REMOVED: "## REMOVED Requirements",
    RENAMED: "## RENAMED Requirements",
  }),
  viewer: Object.freeze({
    defaultPort: 4177,
    maximumPort: 65535,
    minimumPort: 0,
  }),
});
