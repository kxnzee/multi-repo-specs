/** @fileoverview Graph report primitives, diagnostics and deterministic finalization. */

export const GRAPH_REPORT_CONTRACT = Object.freeze({
  graphVersion: 1,
  reportVersion: 1,
  severity: Object.freeze({ error: "error", warning: "warning" }),
  state: Object.freeze({ invalid: "invalid", ready: "ready" }),
  status: Object.freeze({ error: "error", ok: "ok", warning: "warning" }),
});

const SEVERITIES = new Set(Object.values(GRAPH_REPORT_CONTRACT.severity));
const STATUS_PRIORITY = Object.freeze({
  [GRAPH_REPORT_CONTRACT.status.ok]: 0,
  [GRAPH_REPORT_CONTRACT.status.warning]: 1,
  [GRAPH_REPORT_CONTRACT.status.error]: 2,
});

/** Creates one stable graph node. */
export function node(id, type, label, attributes = {}) {
  return { id, type, label, ...attributes };
}

/** Creates one stable graph edge. */
export function edge(id, source, relation, target, attributes = {}) {
  return { id, source, relation, target, provenance: [], derived: true, ...attributes };
}

/** Creates one machine-readable Store source location. */
export function source(path, line, field) {
  return Object.freeze({ path, line, field });
}

/** Rejects Store structures that cannot be compiled even partially. */
export function fatal(message, options) {
  throw new Error(`OPENSPEC_GRAPH_FATAL: ${message}`, options);
}

/** Produces one diagnostic with stable source and affected elements. */
export function diagnostic(code, severity, message, { elements = [], source: location } = {}) {
  if (!SEVERITIES.has(severity)) fatal(`unknown diagnostic severity ${severity}`);
  return {
    code,
    severity,
    message,
    elements: [...new Set(elements)].sort(),
    ...(location ? { source: Object.freeze({ ...location }) } : {}),
  };
}

/** Adds an edge once and fails only for internal compiler identity conflicts. */
export function addEdge(edges, candidate) {
  if (edges.has(candidate.id)) fatal(`duplicate edge identity ${candidate.id}`);
  edges.set(candidate.id, candidate);
  return candidate;
}

/** Returns a deterministic identity for one source location. */
function provenanceKey(value) {
  return `${value.path}\0${value.line}\0${value.field}`;
}

/** Adds one source location to an aggregate edge. */
export function addProvenance(candidate, location, changeId) {
  const key = provenanceKey(location);
  if (!candidate.provenance.some((value) => provenanceKey(value) === key)) {
    candidate.provenance.push(location);
  }
  if (changeId && !candidate.via_changes.includes(changeId)) candidate.via_changes.push(changeId);
}

/** Freezes an element and assigns its most severe diagnostic state. */
function reportElement(value, statuses) {
  return Object.freeze({
    ...value,
    status: statuses.get(value.id) ?? GRAPH_REPORT_CONTRACT.status.ok,
  });
}

/** Sorts source locations without serializing them into lossy strings. */
function compareProvenance(left, right) {
  return left.path.localeCompare(right.path)
    || left.line - right.line
    || left.field.localeCompare(right.field);
}

/** Finalizes a deterministic graph report. */
export function finalizeReport(nodes, edges, diagnostics) {
  const normalizedDiagnostics = diagnostics.map((value, index) => Object.freeze({
    id: `diagnostic:${index + 1}`,
    ...value,
    elements: Object.freeze([...value.elements]),
  }));
  const statuses = new Map();
  for (const value of normalizedDiagnostics) {
    for (const elementId of value.elements) {
      const current = statuses.get(elementId) ?? GRAPH_REPORT_CONTRACT.status.ok;
      if (STATUS_PRIORITY[value.severity] > STATUS_PRIORITY[current]) {
        statuses.set(elementId, value.severity);
      }
    }
  }
  const sortedNodes = [...nodes.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) => reportElement(value, statuses));
  const sortedEdges = [...edges.values()]
    .map((value) => ({
      ...value,
      provenance: Object.freeze([...value.provenance]
        .sort(compareProvenance)
        .map((location) => Object.freeze({ ...location }))),
      ...(value.via_changes ? { via_changes: Object.freeze([...value.via_changes].sort()) } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) => reportElement(value, statuses));
  const errors = normalizedDiagnostics.filter(
    ({ severity }) => severity === GRAPH_REPORT_CONTRACT.severity.error,
  ).length;
  const warnings = normalizedDiagnostics.filter(
    ({ severity }) => severity === GRAPH_REPORT_CONTRACT.severity.warning,
  ).length;
  return Object.freeze({
    report_version: GRAPH_REPORT_CONTRACT.reportVersion,
    graph_version: GRAPH_REPORT_CONTRACT.graphVersion,
    state: errors > 0
      ? GRAPH_REPORT_CONTRACT.state.invalid
      : GRAPH_REPORT_CONTRACT.state.ready,
    nodes: Object.freeze(sortedNodes),
    edges: Object.freeze(sortedEdges),
    diagnostics: Object.freeze(normalizedDiagnostics),
    summary: Object.freeze({ nodes: sortedNodes.length, edges: sortedEdges.length, errors, warnings }),
  });
}
