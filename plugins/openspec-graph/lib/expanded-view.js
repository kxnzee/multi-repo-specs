/** @fileoverview Viewer-only composition of independently scoped Store graphs. */

/** Namespaces an identity while retaining its graph type prefix. */
export function scopedGraphId(repositoryId, id) {
  const colon = id.indexOf(":");
  return `${id.slice(0, colon + 1)}${encodeURIComponent(repositoryId)}::${id.slice(colon + 1)}`;
}

/** Adds one team's internal graph without changing either input report. */
export function expandStoreGraph(parent, repositoryId, child) {
  const scope = (id) => scopedGraphId(repositoryId, id);
  const changeId = (id) => `${encodeURIComponent(repositoryId)}::${id}`;
  const provenance = (value) => ({ ...value, team_id: repositoryId });
  const repositoryNodeId = `repository:${repositoryId}`;
  const rootIds = new Set(child.nodes.filter(({ type }) => type === "store").map(({ id }) => id));

  const nodes = child.nodes.filter(({ type }) => type !== "store").map((node) => {
    const scoped = {
      ...node,
      id: scope(node.id),
      team_id: repositoryId,
      original_id: node.id,
      source: child.source,
    };
    if (node.change_id) {
      scoped.original_change_id = node.change_id;
      scoped.change_id = changeId(node.change_id);
    }
    return scoped;
  });

  const edges = child.edges
    .filter(({ source, target }) => !rootIds.has(source) && !rootIds.has(target))
    .map((edge) => {
      const scoped = {
        ...edge,
        id: scope(edge.id),
        source: scope(edge.source),
        target: scope(edge.target),
        team_id: repositoryId,
        provenance: (edge.provenance ?? []).map(provenance),
      };
      if (edge.via_changes) scoped.via_changes = edge.via_changes.map(changeId);
      return scoped;
    });

  for (const node of nodes.filter(({ type }) => type === "repository")) {
    edges.push({
      id: `expanded:${repositoryId}:${node.id}`,
      source: repositoryNodeId,
      target: node.id,
      relation: "contains",
      status: "ok",
      provenance: [],
      derived: true,
    });
  }

  const diagnostics = child.diagnostics.map((value) => {
    const scoped = {
      ...value,
      id: scope(value.id),
      team_id: repositoryId,
      message: `${repositoryId}: ${value.message}`,
      elements: value.elements.map((id) => rootIds.has(id) ? repositoryNodeId : scope(id)),
    };
    if (value.source) scoped.source = provenance(value.source);
    return scoped;
  });

  const errors = parent.summary.errors + child.summary.errors;
  return {
    ...parent,
    nodes: [...parent.nodes, ...nodes],
    edges: [...parent.edges, ...edges],
    diagnostics: [...parent.diagnostics, ...diagnostics],
    state: errors > 0 ? "invalid" : "ready",
    summary: {
      nodes: parent.nodes.length + nodes.length,
      edges: parent.edges.length + edges.length,
      errors,
      warnings: parent.summary.warnings + child.summary.warnings,
    },
  };
}
