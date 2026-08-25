/** @fileoverview Deterministic projection of OpenSpec and explicit graph links. */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

const GRAPH_VERSION = 1;
const OPERATIONS = new Set(["ADDED", "MODIFIED", "REMOVED", "RENAMED"]);
const EDGE_KEYS = new Set(["contract", "relation", "source", "sources", "target"]);
const RELATIONS = new Map([
  ["repository:repository", new Set(["calls", "depends_on", "publishes_to"])],
  ["master-spec:repository", new Set(["implemented_by"])],
  ["repository:master-spec", new Set(["verifies"])],
  ["master-spec:master-spec", new Set(["depends_on"])],
  ["delta-spec:repository", new Set(["targets"])],
  ["delta-spec:delta-spec", new Set(["depends_on"])],
]);

/** Creates one stable graph node. */
function node(id, type, label, attributes = {}) {
  return Object.freeze({ id, type, label, ...attributes });
}

/** Rejects paths and documents that cannot be projected safely. */
function invalid(message) {
  throw new Error(`OPENSPEC_GRAPH_INVALID: ${message}`);
}

/** Lists ordinary spec.md files below a repository-relative directory. */
async function specFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  let stat;
  try {
    stat = await fs.lstat(absoluteRoot);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    invalid(`${relativeRoot} must be an ordinary directory`);
  }
  const found = [];
  /** Visits one ordinary directory in stable name order. */
  async function visit(absoluteDirectory, relativeDirectory) {
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) invalid(`${relativePath} must not be a symlink`);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else if (entry.isFile() && entry.name === "spec.md") found.push(relativePath);
    }
  }
  await visit(absoluteRoot, relativeRoot);
  return found;
}

/** Lists immediate ordinary child directories in stable name order. */
async function ordinaryDirectories(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  let stat;
  try {
    stat = await fs.lstat(absoluteRoot);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    invalid(`${relativeRoot} must be an ordinary directory`);
  }
  const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const directories = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isSymbolicLink()) invalid(`${relativePath} must not be a symlink`);
    if (entry.isDirectory()) directories.push(entry.name);
  }
  return directories;
}

/** Returns the capability path represented by one spec file. */
function capabilityFrom(file, marker) {
  const prefix = `${marker}/`;
  if (!file.startsWith(prefix) || !file.endsWith("/spec.md")) {
    invalid(`cannot derive capability from ${file}`);
  }
  const capability = file.slice(prefix.length, -"/spec.md".length);
  if (!capability || capability.split("/").some((segment) => !segment)) {
    invalid(`invalid capability path in ${file}`);
  }
  return capability;
}

/** Extracts standard OpenSpec Delta operation headings with provenance lines. */
function deltaOperations(source, file) {
  const operations = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = line.match(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*$/u);
    if (match && OPERATIONS.has(match[1])) {
      operations.push(Object.freeze({ operation: match[1], line: index + 1 }));
    }
  }
  if (operations.length === 0) invalid(`${file} has no standard Delta operation section`);
  return operations;
}

/** Parses a graph node reference without guessing its type. */
function referenceType(reference) {
  if (typeof reference !== "string") invalid("edge references must be strings");
  const separator = reference.indexOf(":");
  if (separator <= 0 || separator === reference.length - 1) {
    invalid(`invalid node reference '${reference}'`);
  }
  return reference.slice(0, separator);
}

/** Validates and materializes explicit edges from openspec/graph.yaml. */
async function validateProvenance(root, value, edgeNumber, changeDefinitions) {
  const match = value.match(/^([^:\\]+(?:\/[^:\\]+)*):(\d+)$/u);
  if (!match || path.posix.isAbsolute(match[1])) {
    invalid(`edge ${edgeNumber} source '${value}' must be a Store-relative path:line`);
  }
  const declaredPath = path.posix.normalize(match[1]);
  let relativePath = declaredPath;
  if (relativePath === "." || relativePath.startsWith("../") || relativePath.includes("/../")) {
    invalid(`edge ${edgeNumber} source '${value}' escapes the Store`);
  }
  let absolutePath = path.join(root, relativePath);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    const activeChange = declaredPath.match(/^openspec\/changes\/([^/]+)\/(.+)$/u);
    const archived = activeChange && changeDefinitions.get(activeChange[1]);
    if (error.code !== "ENOENT") throw error;
    if (archived?.state !== "archived") {
      invalid(`edge ${edgeNumber} source does not exist: ${declaredPath}`);
    }
    relativePath = `${archived.path}/${activeChange[2]}`;
    absolutePath = path.join(root, relativePath);
    try {
      stat = await fs.lstat(absolutePath);
    } catch (archiveError) {
      if (archiveError.code === "ENOENT") {
        invalid(`edge ${edgeNumber} source does not exist: ${declaredPath}`);
      }
      throw archiveError;
    }
  }
  let source;
  try {
    if (!stat.isFile() || stat.isSymbolicLink()) {
      invalid(`edge ${edgeNumber} source '${relativePath}' must be an ordinary file`);
    }
    const resolvedPath = await fs.realpath(absolutePath);
    if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${path.sep}`)) {
      invalid(`edge ${edgeNumber} source '${relativePath}' escapes the Store`);
    }
    source = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") invalid(`edge ${edgeNumber} source does not exist: ${declaredPath}`);
    throw error;
  }
  const line = Number(match[2]);
  const lineCount = source.split(/\r?\n/u).length;
  if (line < 1 || line > lineCount) {
    invalid(`edge ${edgeNumber} source line is outside ${relativePath}: ${line}`);
  }
  return Object.freeze({ reference: `${relativePath}:${line}`, path: relativePath, source });
}

/** Validates and materializes explicit edges from openspec/graph.yaml. */
async function explicitEdges(document, nodes, root, changeDefinitions) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    invalid("openspec/graph.yaml must contain an object");
  }
  const keys = Object.keys(document).sort();
  if (keys.join("\0") !== ["edges", "version"].join("\0")) {
    invalid("openspec/graph.yaml must contain only version and edges");
  }
  if (document.version !== GRAPH_VERSION) {
    invalid(`openspec/graph.yaml version must be ${GRAPH_VERSION}`);
  }
  if (!Array.isArray(document.edges)) invalid("openspec/graph.yaml edges must be an array");
  const identities = new Set();
  const edges = [];
  const evidence = new Map();
  for (const [index, value] of document.edges.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(`edge ${index + 1} must be an object`);
    }
    const unknown = Object.keys(value).filter((key) => !EDGE_KEYS.has(key));
    if (unknown.length > 0) invalid(`edge ${index + 1} has unknown field '${unknown[0]}'`);
    const { source, relation, target, contract, sources } = value;
    if (!nodes.has(source)) invalid(`edge ${index + 1} source does not exist: ${source}`);
    if (!nodes.has(target)) invalid(`edge ${index + 1} target does not exist: ${target}`);
    if (!Array.isArray(sources) || sources.length === 0 ||
      sources.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      invalid(`edge ${index + 1} requires non-empty sources`);
    }
    if (contract !== undefined && (typeof contract !== "string" || !contract.trim())) {
      invalid(`edge ${index + 1} contract must be a non-empty string`);
    }
    const pair = `${referenceType(source)}:${referenceType(target)}`;
    if (typeof relation !== "string" || !RELATIONS.get(pair)?.has(relation)) {
      invalid(`edge ${index + 1} relation '${relation ?? ""}' is not allowed for ${pair}`);
    }
    if (["calls", "publishes_to"].includes(relation) && contract === undefined) {
      invalid(`edge ${index + 1} relation '${relation}' requires contract`);
    }
    const identity = `${source}\0${relation}\0${target}`;
    if (identities.has(identity)) invalid(`duplicate edge ${source} ${relation} ${target}`);
    identities.add(identity);
    const provenance = [];
    for (const item of sources) {
      const validated = await validateProvenance(root, item, index + 1, changeDefinitions);
      provenance.push(validated.reference);
      evidence.set(validated.path, validated.source);
    }
    edges.push(Object.freeze({
      id: `explicit:${index + 1}`,
      source,
      relation,
      target,
      provenance: Object.freeze(provenance),
      ...(contract === undefined ? {} : { contract }),
      derived: false,
    }));
  }
  return Object.freeze({ edges, evidence });
}

/** Normalizes an archived OpenSpec directory to its original Change ID. */
function archivedChangeId(directory) {
  return directory.replace(/^\d{4}-\d{2}-\d{2}-/u, "");
}

/** Builds a deterministic graph from the Store checkout. */
export async function buildOpenSpecGraph(projectRoot, { repositories = [], storeId } = {}) {
  const root = await fs.realpath(projectRoot);
  if (!Array.isArray(repositories)) invalid("repositories must be an array");
  if (typeof storeId !== "string" || storeId.trim().length === 0) {
    invalid("storeId must be a non-empty string");
  }
  const inputs = new Map();
  const nodes = new Map();
  const storeNodeId = `store:${storeId}`;
  nodes.set(storeNodeId, node(storeNodeId, "store", storeId, { store_id: storeId }));
  const derivedEdges = [];
  for (const repository of [...repositories].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!repository || typeof repository.id !== "string" || repository.role !== "code") {
      invalid("repositories must contain code repository handles");
    }
    const id = `repository:${repository.id}`;
    if (nodes.has(id)) invalid(`duplicate repository ${repository.id}`);
    nodes.set(id, node(id, "repository", repository.id, { repository_id: repository.id }));
    derivedEdges.push(Object.freeze({
      id: `derived:${storeNodeId}:contains:${id}`,
      source: storeNodeId,
      relation: "contains",
      target: id,
      provenance: Object.freeze([]),
      derived: true,
    }));
  }

  const masterFiles = await specFiles(root, "openspec/specs");
  for (const file of masterFiles) {
    const capability = capabilityFrom(file, "openspec/specs");
    const source = await fs.readFile(path.join(root, file), "utf8");
    inputs.set(file, source);
    const id = `master-spec:${capability}`;
    nodes.set(id, node(id, "master-spec", capability, {
      capability,
      path: file,
      state: "current",
    }));
  }

  const deltaFiles = (await specFiles(root, "openspec/changes"))
    .filter((file) => !file.startsWith("openspec/changes/archive/"));
  const archiveFiles = await specFiles(root, "openspec/changes/archive");
  const changeDefinitions = new Map();
  const activeChangeDirectories = (await ordinaryDirectories(root, "openspec/changes"))
    .filter((directory) => directory !== "archive");
  const archivedChangeDirectories = await ordinaryDirectories(root, "openspec/changes/archive");
  const changes = [
    ...activeChangeDirectories.map((directory) => ({ directory, archived: false })),
    ...archivedChangeDirectories.map((directory) => ({ directory, archived: true })),
  ];
  for (const { directory, archived } of changes) {
    const changeId = archived ? archivedChangeId(directory) : directory;
    if (!changeId) invalid(`invalid Change directory ${directory}`);
    const changePath = archived
      ? `openspec/changes/archive/${directory}`
      : `openspec/changes/${directory}`;
    const state = archived ? "archived" : "active";
    if (changeDefinitions.has(changeId)) invalid(`duplicate Change ${changeId}`);
    changeDefinitions.set(changeId, { path: changePath, state });
    const changeIdRef = `change:${changeId}`;
    nodes.set(changeIdRef, node(changeIdRef, "change", changeId, {
      change_id: changeId,
      path: changePath,
      state,
    }));
    inputs.set(`${changePath}/`, state);
  }
  for (const file of [...deltaFiles, ...archiveFiles]) {
    const archived = file.startsWith("openspec/changes/archive/");
    const parts = file.split("/");
    const directory = archived ? parts[3] : parts[2];
    const marker = archived
      ? `openspec/changes/archive/${directory}/specs`
      : `openspec/changes/${directory}/specs`;
    const changeId = archived ? archivedChangeId(directory) : directory;
    const changePath = archived
      ? `openspec/changes/archive/${directory}`
      : `openspec/changes/${directory}`;
    const changeState = archived ? "archived" : "active";
    const changeDefinition = changeDefinitions.get(changeId);
    if (!changeDefinition
      || changeDefinition.path !== changePath
      || changeDefinition.state !== changeState) {
      invalid(`cannot resolve Change ${changeId}`);
    }
    const changeIdRef = `change:${changeId}`;
    const capability = capabilityFrom(file, marker);
    const source = await fs.readFile(path.join(root, file), "utf8");
    inputs.set(file, source);
    const deltaId = `delta-spec:${changeId}/${capability}`;
    if (nodes.has(deltaId)) invalid(`duplicate Delta Spec ${deltaId}`);
    nodes.set(deltaId, node(deltaId, "delta-spec", `${changeId}: ${capability}`, {
      capability,
      change_id: changeId,
      path: file,
      state: changeState,
    }));
    derivedEdges.push(Object.freeze({
      id: `derived:${changeIdRef}:contains:${deltaId}`,
      source: changeIdRef,
      relation: "contains",
      target: deltaId,
      provenance: Object.freeze([]),
      derived: true,
    }));
    const masterId = `master-spec:${capability}`;
    if (!nodes.has(masterId)) {
      nodes.set(masterId, node(masterId, "master-spec", capability, {
        capability,
        path: null,
        state: "planned",
      }));
    }
    const operations = deltaOperations(source, file);
    derivedEdges.push(Object.freeze({
      id: `derived:${changeIdRef}:affects:${masterId}`,
      source: changeIdRef,
      relation: "affects",
      target: masterId,
      operations: Object.freeze(operations.map(({ operation }) => operation)),
      provenance: Object.freeze(operations.map(({ line }) => `${file}:${line}`)),
      derived: true,
    }));
    for (const [operationIndex, operation] of operations.entries()) {
      derivedEdges.push(Object.freeze({
        id: `derived:${deltaId}:${operation.operation}:${operationIndex + 1}`,
        source: deltaId,
        relation: "changes",
        target: masterId,
        operation: operation.operation,
        provenance: Object.freeze([`${file}:${operation.line}`]),
        derived: true,
      }));
    }
  }

  const graphPath = "openspec/graph.yaml";
  let graphSource;
  try {
    graphSource = await fs.readFile(path.join(root, graphPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") invalid(`${graphPath} is required`);
    throw error;
  }
  inputs.set(graphPath, graphSource);
  let graphDocument;
  try {
    graphDocument = parseYaml(graphSource);
  } catch (error) {
    invalid(`${graphPath}: ${error.message}`);
  }
  const declared = await explicitEdges(graphDocument, nodes, root, changeDefinitions);
  for (const [file, source] of declared.evidence) inputs.set(file, source);
  const sortedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = [...derivedEdges, ...declared.edges].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  const digest = createHash("sha256");
  const repositoryInputs = repositories
    .map(({ id, role }) => ({ id, role }))
    .sort((left, right) => left.id.localeCompare(right.id));
  digest.update(JSON.stringify({ store_id: storeId, repositories: repositoryInputs }));
  for (const [file, source] of [...inputs.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    digest.update(`\0${file}\0${source}`);
  }
  return Object.freeze({
    graph_version: GRAPH_VERSION,
    source_digest: digest.digest("hex"),
    nodes: Object.freeze(sortedNodes),
    edges: Object.freeze(sortedEdges),
  });
}
