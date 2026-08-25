/** @fileoverview Provider-independent read queries over one validated graph. */

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

/** Returns direct and dependency-propagated capability and Repository impact. */
export function inspectChangeImpact(graph, changeId) {
  const nodesById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const change = graph.nodes.find(
    ({ type, change_id: candidate }) => type === "change" && candidate === changeId,
  );
  if (!change) unknown("CHANGE", changeId);
  const containmentEdges = graph.edges.filter(
    ({ source, relation }) => source === change.id && relation === "contains",
  );
  const containedDeltaIds = new Set(containmentEdges.map(({ target }) => target));
  const deltas = graph.nodes.filter(({ id, type }) => (
    type === "delta-spec" && containedDeltaIds.has(id)
  ));
  const deltaIds = new Set(deltas.map(({ id }) => id));
  const affectEdges = graph.edges.filter(
    ({ source, relation }) => source === change.id && relation === "affects",
  );
  const changeEdges = graph.edges.filter(
    ({ source, relation }) => deltaIds.has(source) && relation === "changes",
  );
  const directMasterIds = new Set([
    ...affectEdges.map(({ target }) => target),
    ...changeEdges.map(({ target }) => target),
  ]);
  const reverseMasterDependencies = new Map();
  for (const edge of graph.edges) {
    if (
      edge.relation !== "depends_on"
      || nodesById.get(edge.source)?.type !== "master-spec"
      || nodesById.get(edge.target)?.type !== "master-spec"
    ) continue;
    if (!reverseMasterDependencies.has(edge.target)) {
      reverseMasterDependencies.set(edge.target, []);
    }
    reverseMasterDependencies.get(edge.target).push(edge);
  }
  const totalMasterIds = new Set(directMasterIds);
  const dependentMasterIds = new Set();
  const masterDependencyImpactEdges = new Map();
  const pendingMasters = [...directMasterIds];
  while (pendingMasters.length > 0) {
    const requiredMasterId = pendingMasters.shift();
    for (const edge of reverseMasterDependencies.get(requiredMasterId) ?? []) {
      masterDependencyImpactEdges.set(edge.id, edge);
      if (totalMasterIds.has(edge.source)) continue;
      totalMasterIds.add(edge.source);
      dependentMasterIds.add(edge.source);
      pendingMasters.push(edge.source);
    }
  }
  const targetEdges = graph.edges.filter(
    ({ source, relation }) => deltaIds.has(source) && relation === "targets",
  );
  const directImplementationEdges = graph.edges.filter(
    ({ source, relation }) => directMasterIds.has(source) && relation === "implemented_by",
  );
  const dependentImplementationEdges = graph.edges.filter(
    ({ source, relation }) => dependentMasterIds.has(source) && relation === "implemented_by",
  );
  const deltaNodes = graph.nodes.filter(({ type }) => type === "delta-spec");
  const deltaChangeById = new Map(deltaNodes.map(({ id, change_id: idOfChange }) => (
    [id, idOfChange]
  )));
  const changeDependencies = new Map();
  const changeDependents = new Map();
  const deltaDependencyEdges = graph.edges.filter(({ source, relation, target }) => (
    relation === "depends_on"
    && deltaChangeById.has(source)
    && deltaChangeById.has(target)
  ));
  for (const edge of deltaDependencyEdges) {
    const sourceChangeId = deltaChangeById.get(edge.source);
    const targetChangeId = deltaChangeById.get(edge.target);
    if (sourceChangeId === targetChangeId) continue;
    if (!changeDependencies.has(sourceChangeId)) changeDependencies.set(sourceChangeId, new Set());
    if (!changeDependents.has(targetChangeId)) changeDependents.set(targetChangeId, new Set());
    changeDependencies.get(sourceChangeId).add(targetChangeId);
    changeDependents.get(targetChangeId).add(sourceChangeId);
  }

  /** Returns direct and more distant Change IDs without returning the selected Change. */
  function traverseChanges(adjacency) {
    const direct = new Set(adjacency.get(changeId) ?? []);
    direct.delete(changeId);
    const transitive = new Set();
    const visited = new Set([changeId, ...direct]);
    const pending = [...direct];
    while (pending.length > 0) {
      const current = pending.shift();
      for (const candidate of adjacency.get(current) ?? []) {
        if (visited.has(candidate)) continue;
        visited.add(candidate);
        transitive.add(candidate);
        pending.push(candidate);
      }
    }
    return { direct, transitive };
  }

  const prerequisites = traverseChanges(changeDependencies);
  const dependents = traverseChanges(changeDependents);
  const directRepositoryIds = new Set(
    [...targetEdges, ...directImplementationEdges].map(({ target }) => target),
  );
  const dependentRepositoryIds = new Set(
    dependentImplementationEdges
      .map(({ target }) => target)
      .filter((repositoryId) => !directRepositoryIds.has(repositoryId)),
  );
  const totalRepositoryIds = new Set([...directRepositoryIds, ...dependentRepositoryIds]);
  const verificationEdges = graph.edges.filter(({ source, relation, target }) => (
    relation === "verifies"
    && nodesById.get(source)?.type === "repository"
    && totalMasterIds.has(target)
  ));
  const verificationRepositoryIds = new Set(
    verificationEdges.map(({ source }) => source),
  );
  const repositoryDependencyEdges = graph.edges.filter(({ source, relation, target }) => {
    if (
      nodesById.get(source)?.type !== "repository"
      || nodesById.get(target)?.type !== "repository"
    ) return false;
    return (relation === "depends_on" || relation === "calls")
      && totalRepositoryIds.has(target);
  });
  const relatedRepositoryIds = new Set(repositoryDependencyEdges
    .map(({ source }) => source)
    .filter((repositoryId) => !totalRepositoryIds.has(repositoryId)));
  const reviewRepositoryIds = new Set([
    ...verificationRepositoryIds,
    ...relatedRepositoryIds,
  ].filter((repositoryId) => !totalRepositoryIds.has(repositoryId)));
  const allRepositoryIds = new Set([...totalRepositoryIds, ...reviewRepositoryIds]);
  const changesFor = (selected) => Object.freeze(graph.nodes.filter(({ type, change_id: id }) => (
    type === "change" && selected.has(id)
  )));
  const prerequisiteChanges = Object.freeze({
    direct: changesFor(prerequisites.direct),
    transitive: changesFor(prerequisites.transitive),
  });
  const dependentChanges = Object.freeze({
    direct: changesFor(dependents.direct),
    transitive: changesFor(dependents.transitive),
  });
  return Object.freeze({
    change_id: changeId,
    change,
    delta_specs: Object.freeze(deltas),
    direct_master_specs: Object.freeze(graph.nodes.filter(({ id }) => directMasterIds.has(id))),
    dependent_master_specs: Object.freeze(
      graph.nodes.filter(({ id }) => dependentMasterIds.has(id)),
    ),
    total_master_specs: Object.freeze(graph.nodes.filter(({ id }) => totalMasterIds.has(id))),
    direct_repositories: Object.freeze(
      graph.nodes.filter(({ id }) => directRepositoryIds.has(id)),
    ),
    dependent_repositories: Object.freeze(
      graph.nodes.filter(({ id }) => dependentRepositoryIds.has(id)),
    ),
    repositories: Object.freeze(graph.nodes.filter(({ id }) => totalRepositoryIds.has(id))),
    verification_repositories: Object.freeze(
      graph.nodes.filter(({ id }) => verificationRepositoryIds.has(id)),
    ),
    related_repositories: Object.freeze(
      graph.nodes.filter(({ id }) => relatedRepositoryIds.has(id)),
    ),
    review_repositories: Object.freeze(
      graph.nodes.filter(({ id }) => reviewRepositoryIds.has(id)),
    ),
    all_repositories: Object.freeze(graph.nodes.filter(({ id }) => allRepositoryIds.has(id))),
    prerequisite_changes: prerequisiteChanges,
    dependent_changes: dependentChanges,
    dependency_changes: Object.freeze([
      ...prerequisiteChanges.direct,
      ...prerequisiteChanges.transitive,
    ]),
    edges: Object.freeze([
      ...containmentEdges,
      ...affectEdges,
      ...changeEdges,
      ...targetEdges,
      ...directImplementationEdges,
      ...dependentImplementationEdges,
      ...verificationEdges,
      ...repositoryDependencyEdges,
      ...masterDependencyImpactEdges.values(),
      ...deltaDependencyEdges,
    ].sort((left, right) => left.id.localeCompare(right.id))),
  });
}

/** Checks a proposed Cycle repository set against deterministic Change impact. */
export function checkChangeScope(graph, changeId, repositoryIds) {
  if (
    !Array.isArray(repositoryIds)
    || repositoryIds.length === 0
    || repositoryIds.some((repositoryId) => (
      typeof repositoryId !== "string" || repositoryId.trim().length === 0
    ))
  ) {
    throw new Error("OPENSPEC_GRAPH_SCOPE_INVALID: repository IDs are required");
  }
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    throw new Error("OPENSPEC_GRAPH_SCOPE_INVALID: duplicate repository ID");
  }

  const repositoryNodes = graph.nodes.filter(({ type }) => type === "repository");
  const repositoryNodesById = new Map(
    repositoryNodes.map((repository) => [repository.repository_id, repository]),
  );
  for (const repositoryId of repositoryIds) {
    if (!repositoryNodesById.has(repositoryId)) {
      throw new Error(`OPENSPEC_GRAPH_REPOSITORY_NOT_FOUND: ${repositoryId}`);
    }
  }

  const impact = inspectChangeImpact(graph, changeId);
  const proposedRepositoryIds = new Set(repositoryIds);
  const requiredRepositoryIds = new Set(
    impact.direct_repositories.map(({ repository_id: repositoryId }) => repositoryId),
  );
  const reviewRepositoryIds = new Set([
    ...impact.dependent_repositories,
    ...impact.review_repositories,
  ].map(({ repository_id: repositoryId }) => repositoryId));
  const knownImpactRepositoryIds = new Set([
    ...requiredRepositoryIds,
    ...reviewRepositoryIds,
  ]);
  const missingRequiredRepositoryIds = new Set([...requiredRepositoryIds]
    .filter((repositoryId) => !proposedRepositoryIds.has(repositoryId)));
  const includedReviewRepositoryIds = new Set([...reviewRepositoryIds]
    .filter((repositoryId) => proposedRepositoryIds.has(repositoryId)));
  const reviewRepositoryIdsOutsideScope = new Set([...reviewRepositoryIds]
    .filter((repositoryId) => !proposedRepositoryIds.has(repositoryId)));
  const extraRepositoryIds = new Set([...proposedRepositoryIds]
    .filter((repositoryId) => !knownImpactRepositoryIds.has(repositoryId)));

  const directMasterIds = new Set(impact.direct_master_specs.map(({ id }) => id));
  const directDeltaIds = new Set(impact.delta_specs.map(({ id }) => id));
  const mappedMasterIds = new Set(graph.edges
    .filter(({ relation, source }) => relation === "implemented_by" && directMasterIds.has(source))
    .map(({ source }) => source));
  const targetedDeltaIds = new Set(graph.edges
    .filter(({ relation, source }) => relation === "targets" && directDeltaIds.has(source))
    .map(({ source }) => source));
  for (const edge of graph.edges) {
    if (
      edge.relation === "changes"
      && targetedDeltaIds.has(edge.source)
      && directMasterIds.has(edge.target)
    ) {
      mappedMasterIds.add(edge.target);
    }
  }
  const unmappedMasterIds = new Set([...directMasterIds]
    .filter((masterId) => !mappedMasterIds.has(masterId)));
  const missingDeltaSpecs = impact.delta_specs.length === 0;
  const state = missingDeltaSpecs
    || missingRequiredRepositoryIds.size > 0
    || unmappedMasterIds.size > 0
    ? "invalid"
    : "ready";
  const orderedRepositoryIds = (selected) => repositoryNodes
    .map(({ repository_id: repositoryId }) => repositoryId)
    .filter((repositoryId) => selected.has(repositoryId));

  return Object.freeze({
    change_id: changeId,
    state,
    proposed_repositories: Object.freeze([...proposedRepositoryIds].sort()),
    required_repositories: Object.freeze(orderedRepositoryIds(requiredRepositoryIds)),
    review_repositories: Object.freeze(orderedRepositoryIds(reviewRepositoryIds)),
    missing_required_repositories: Object.freeze(
      orderedRepositoryIds(missingRequiredRepositoryIds),
    ),
    included_review_repositories: Object.freeze(
      orderedRepositoryIds(includedReviewRepositoryIds),
    ),
    review_repositories_outside_scope: Object.freeze(
      orderedRepositoryIds(reviewRepositoryIdsOutsideScope),
    ),
    extra_repositories: Object.freeze(orderedRepositoryIds(extraRepositoryIds)),
    missing_delta_specs: missingDeltaSpecs,
    unmapped_master_specs: Object.freeze(impact.direct_master_specs
      .filter(({ id }) => unmappedMasterIds.has(id))
      .map(({ capability }) => capability)),
  });
}
