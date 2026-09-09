/** @fileoverview Cross-Store viewer composition preserves identity and impact queries. */
import assert from "node:assert/strict";
import test from "node:test";
import { expandStoreGraph } from "../lib/expanded-view.js";
import { inspectChangeImpact } from "../lib/query.js";

const child = {
  nodes: [{ id: "store:specs", type: "store" },
    { id: "repository:api", type: "repository" },
    { id: "master-spec:shared", type: "master-spec", capability: "shared" },
    { id: "change:work", type: "change", change_id: "work" },
    { id: "delta-spec:work/shared", type: "delta-spec", change_id: "work", capability: "shared" }],
  edges: [
    { id: "edge:1", source: "change:work", target: "delta-spec:work/shared", relation: "contains" },
    { id: "edge:2", source: "change:work", target: "master-spec:shared", relation: "affects" },
    { id: "edge:3", source: "change:work", target: "repository:api", relation: "changes_in" },
    { id: "edge:4", source: "repository:api", target: "master-spec:shared", relation: "linked", via_changes: ["work"],
      provenance: [{ path: "openspec/changes/work/proposal.md", line: 1, field: "impact" }] },
  ], diagnostics: [], summary: { errors: 0, warnings: 0 },
};

test("two identically named team graphs stay distinct and retain local impact", () => {
  const parent = { nodes: [{ id: "repository:a", role: "specs" }, { id: "repository:b", role: "specs" }],
    edges: [], diagnostics: [], summary: { errors: 0, warnings: 0 } };
  const graph = expandStoreGraph(expandStoreGraph(parent, "a", child), "b", child);
  assert.equal(new Set(graph.nodes.map(({ id }) => id)).size, graph.nodes.length);
  assert.equal(new Set(graph.edges.map(({ id }) => id)).size, graph.edges.length);
  for (const team of ["a", "b"]) {
    const impact = inspectChangeImpact(graph, `${team}::work`);
    assert.equal(impact.repositories.length, 1);
    assert.equal(impact.repositories[0].team_id, team);
    assert.equal(impact.master_specs[0].team_id, team);
    assert.equal(impact.edges.find(({ relation }) => relation === "linked").provenance[0].team_id, team);
  }
  assert.equal(parent.nodes.length, 2);
  assert.equal(child.nodes[3].change_id, "work");
});

test("an invalid team makes the composed report invalid", () => {
  const parent = { state: "ready", nodes: [], edges: [], diagnostics: [], summary: { errors: 0, warnings: 0 } };
  const graph = expandStoreGraph(parent, "a", { ...child, summary: { errors: 1, warnings: 2 } });
  assert.equal(graph.state, "invalid");
  assert.equal(graph.summary.errors, 1);
  assert.equal(graph.summary.warnings, 2);
  assert.equal(parent.state, "ready");
});
