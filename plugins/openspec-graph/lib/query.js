/** @fileoverview Provider-independent read queries over one compiled graph report. */

/** Rejects an unknown graph identifier without fuzzy matching. */
function unknown(kind, value) {
  throw new Error(`OPENSPEC_GRAPH_${kind}_NOT_FOUND: ${value}`);
}

/** Returns one node, its incident edges and exact neighboring nodes. */
export function inspectGraphNode(graph, nodeId) {
  const selected = graph.nodes.find(({ id }) => id === nodeId);
  if (!selected) unknown("NODE", nodeId);
  const edges = graph.edges.filter(({ source, target }) => source === nodeId || target === nodeId);
  const neighborIds = new Set();
  for (const edge of edges) {
    if (edge.source !== nodeId) neighborIds.add(edge.source);
    if (edge.target !== nodeId) neighborIds.add(edge.target);
  }
  return Object.freeze({
    node: selected,
    edges: Object.freeze(edges),
    neighbors: Object.freeze(graph.nodes.filter(({ id }) => neighborIds.has(id))),
  });
}

/** Returns the structural capability and Repository impact declared by one Change. */
export function inspectChangeImpact(graph, changeId) {
  const change = graph.nodes.find(
    ({ type, change_id: candidate }) => type === "change" && candidate === changeId,
  );
  if (!change) unknown("CHANGE", changeId);
  const containmentEdges = graph.edges.filter(
    ({ source, relation }) => source === change.id && relation === "contains",
  );
  const deltaIds = new Set(containmentEdges.map(({ target }) => target));
  const deltas = graph.nodes.filter(({ id, type }) => type === "delta-spec" && deltaIds.has(id));
  const affectEdges = graph.edges.filter(
    ({ source, relation }) => source === change.id && relation === "affects",
  );
  const changeEdges = graph.edges.filter(
    ({ source, relation }) => deltaIds.has(source) && relation === "changes",
  );
  const repositoryEdges = graph.edges.filter(
    ({ source, relation }) => source === change.id && relation === "changes_in",
  );
  const masterIds = new Set([
    ...affectEdges.map(({ target }) => target),
    ...changeEdges.map(({ target }) => target),
  ]);
  const repositoryIds = new Set(repositoryEdges.map(({ target }) => target));
  const linkedEdges = graph.edges.filter(({ source, relation, target, via_changes: changes }) => (
    relation === "linked"
    && repositoryIds.has(source)
    && masterIds.has(target)
    && changes?.includes(changeId)
  ));
  const masters = Object.freeze(graph.nodes.filter(({ id }) => masterIds.has(id)));
  const repositories = Object.freeze(graph.nodes.filter(({ id }) => repositoryIds.has(id)));
  return Object.freeze({
    change_id: changeId,
    change,
    delta_specs: Object.freeze(deltas),
    master_specs: masters,
    repositories,
    edges: Object.freeze([
      ...containmentEdges,
      ...affectEdges,
      ...changeEdges,
      ...repositoryEdges,
      ...linkedEdges,
    ].sort((left, right) => left.id.localeCompare(right.id))),
  });
}
