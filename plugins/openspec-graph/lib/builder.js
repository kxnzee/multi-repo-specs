/** @fileoverview Stateless projection of parsed OpenSpec Store inputs into a graph report. */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  archivedChangeId,
  capabilityFrom,
  changeMetadata,
  ordinaryDirectories,
  parseRepositoryImpact,
  readOptionalFile,
  repositorySources,
  specFiles,
} from "./compiler-input.js";
import {
  operationHeadingConfig,
  parseDeltaOperations,
} from "./operation-headings.js";
import {
  addEdge,
  addProvenance,
  diagnostic,
  edge,
  fatal,
  finalizeReport,
  GRAPH_REPORT_CONTRACT,
  node,
  source,
} from "./report.js";

const { error: ERROR, warning: WARNING } = GRAPH_REPORT_CONTRACT.severity;

/** Owns one in-memory compilation while keeping every projection stage explicit. */
class GraphCompilation {
  #root;
  #repositories;
  #nodes = new Map();
  #edges = new Map();
  #diagnostics;
  #operationHeadings;
  #repositoryIds = new Set();
  #storeNodeId;
  #changeDefinitions = new Map();
  #linkedCapabilities = new Set();

  constructor(root, repositories, storeId, operationConfig) {
    this.#root = root;
    this.#repositories = repositories;
    this.#diagnostics = [...operationConfig.diagnostics];
    this.#operationHeadings = operationConfig.headings;
    this.#storeNodeId = `store:${storeId}`;
    this.#nodes.set(
      this.#storeNodeId,
      node(this.#storeNodeId, "store", storeId, { store_id: storeId }),
    );
  }

  async compile() {
    await this.#projectRepositories();
    await this.#projectMasterSpecs();
    await this.#projectChanges();
    await this.#projectDeltaSpecs();
    await this.#projectRepositoryRelations();
    this.#diagnoseUnlinkedMasterSpecs();
    return finalizeReport(this.#nodes, this.#edges, this.#diagnostics);
  }

  /** Projects registered Code Repositories and their Store containment. */
  async #projectRepositories() {
    const provenance = await repositorySources(
      this.#root,
      this.#repositories.map(({ id }) => id),
    );
    for (const repository of [...this.#repositories].sort((a, b) => a.id.localeCompare(b.id))) {
      const repositoryNodeId = `repository:${repository.id}`;
      if (this.#nodes.has(repositoryNodeId)) fatal(`duplicate repository ${repository.id}`);
      this.#repositoryIds.add(repository.id);
      this.#nodes.set(repositoryNodeId, node(repositoryNodeId, "repository", repository.id, {
        repository_id: repository.id,
        state: "registered",
      }));
      addEdge(this.#edges, edge(
        `derived:${this.#storeNodeId}:contains:${repositoryNodeId}`,
        this.#storeNodeId,
        "contains",
        repositoryNodeId,
        { provenance: [provenance.get(repository.id)] },
      ));
    }
  }

  /** Ensures that one capability has a Master node and a sourced containment edge. */
  #ensureMaster(capability, attributes, provenance) {
    const masterNodeId = `master-spec:${capability}`;
    if (!this.#nodes.has(masterNodeId)) {
      this.#nodes.set(masterNodeId, node(masterNodeId, "master-spec", capability, {
        capability,
        ...attributes,
      }));
      addEdge(this.#edges, edge(
        `derived:${this.#storeNodeId}:contains:${masterNodeId}`,
        this.#storeNodeId,
        "contains",
        masterNodeId,
        { provenance: [provenance] },
      ));
    }
    return masterNodeId;
  }

  /** Projects the current Master Specs before any planned or missing placeholders. */
  async #projectMasterSpecs() {
    for (const file of await specFiles(this.#root, "openspec/specs")) {
      const capability = capabilityFrom(file, "openspec/specs");
      this.#ensureMaster(
        capability,
        { path: file, state: "current" },
        source(file, 1, "capability"),
      );
    }
  }

  /** Projects active and archived Change definitions in their original traversal order. */
  async #projectChanges() {
    const activeDirectories = (await ordinaryDirectories(this.#root, "openspec/changes"))
      .filter((directory) => directory !== "archive");
    const archivedDirectories = await ordinaryDirectories(
      this.#root,
      "openspec/changes/archive",
    );
    const changes = [
      ...activeDirectories.map((directory) => ({ directory, archived: false })),
      ...archivedDirectories.map((directory) => ({ directory, archived: true })),
    ];
    for (const { directory, archived } of changes) {
      const changeId = archived ? archivedChangeId(directory) : directory;
      if (!changeId) fatal(`invalid Change directory ${directory}`);
      if (this.#changeDefinitions.has(changeId)) fatal(`duplicate Change ${changeId}`);
      const changePath = archived
        ? `openspec/changes/archive/${directory}`
        : `openspec/changes/${directory}`;
      const state = archived ? "archived" : "active";
      const changeNodeId = `change:${changeId}`;
      const metadata = await changeMetadata(this.#root, changePath, changeNodeId);
      this.#diagnostics.push(...metadata.diagnostics);
      this.#changeDefinitions.set(changeId, {
        id: changeId,
        nodeId: changeNodeId,
        path: changePath,
        state,
        skipSpecs: metadata.skipSpecs,
        capabilities: new Set(),
      });
      this.#nodes.set(changeNodeId, node(changeNodeId, "change", changeId, {
        change_id: changeId,
        path: changePath,
        state,
      }));
      addEdge(this.#edges, edge(
        `derived:${this.#storeNodeId}:contains:${changeNodeId}`,
        this.#storeNodeId,
        "contains",
        changeNodeId,
        { provenance: [source(changePath, 1, "change")] },
      ));
    }
  }

  /** Projects all active Delta Specs before archived Delta Specs. */
  async #projectDeltaSpecs() {
    const activeFiles = (await specFiles(this.#root, "openspec/changes"))
      .filter((file) => !file.startsWith("openspec/changes/archive/"));
    const archivedFiles = await specFiles(this.#root, "openspec/changes/archive");
    for (const file of [...activeFiles, ...archivedFiles]) {
      await this.#projectDeltaSpec(file);
    }
  }

  /** Projects one Delta Spec, its Master relation and operation diagnostics. */
  async #projectDeltaSpec(file) {
    const archived = file.startsWith("openspec/changes/archive/");
    const parts = file.split("/");
    const directory = archived ? parts[3] : parts[2];
    const marker = archived
      ? `openspec/changes/archive/${directory}/specs`
      : `openspec/changes/${directory}/specs`;
    const changeId = archived ? archivedChangeId(directory) : directory;
    const change = this.#changeDefinitions.get(changeId);
    if (!change) fatal(`cannot resolve Change ${changeId}`);
    const capability = capabilityFrom(file, marker);
    change.capabilities.add(capability);
    const deltaNodeId = `delta-spec:${changeId}/${capability}`;
    if (this.#nodes.has(deltaNodeId)) fatal(`duplicate Delta Spec ${deltaNodeId}`);
    this.#nodes.set(deltaNodeId, node(deltaNodeId, "delta-spec", `${changeId}: ${capability}`, {
      capability,
      change_id: changeId,
      path: file,
      state: change.state,
    }));
    addEdge(this.#edges, edge(
      `derived:${change.nodeId}:contains:${deltaNodeId}`,
      change.nodeId,
      "contains",
      deltaNodeId,
      { provenance: [source(file, 1, "delta-spec")] },
    ));

    const existingMaster = this.#nodes.get(`master-spec:${capability}`);
    const currentMasterExists = existingMaster?.state === "current";
    const masterState = archived && !currentMasterExists ? "missing" : "planned";
    const masterNodeId = this.#ensureMaster(
      capability,
      {
        path: null,
        state: masterState,
        ...(masterState === "missing" ? { placeholder: true } : {}),
      },
      source(file, 1, "capability"),
    );
    if (archived && !currentMasterExists && existingMaster) {
      this.#nodes.set(masterNodeId, node(masterNodeId, "master-spec", capability, {
        ...existingMaster,
        path: null,
        state: "missing",
        placeholder: true,
      }));
    }

    const deltaSource = await fs.readFile(path.join(this.#root, file), "utf8");
    const parsedOperations = parseDeltaOperations(deltaSource, this.#operationHeadings);
    this.#projectDeltaOperations({
      archived,
      capability,
      change,
      deltaNodeId,
      file,
      masterNodeId,
      currentMasterExists,
      parsedOperations,
    });
  }

  /** Projects operation edges while preserving their diagnostic order. */
  #projectDeltaOperations({
    archived,
    capability,
    change,
    deltaNodeId,
    file,
    masterNodeId,
    currentMasterExists,
    parsedOperations,
  }) {
    const operations = parsedOperations.operations;
    const affectsEdgeId = `derived:${change.nodeId}:affects:${masterNodeId}`;
    const operationSources = operations.map(({ line, operation }) => (
      source(file, line, `delta-operations.${operation}`)
    ));
    addEdge(this.#edges, edge(affectsEdgeId, change.nodeId, "affects", masterNodeId, {
      operations: operations.map(({ operation }) => operation),
      provenance: operationSources.length > 0
        ? operationSources
        : [source(file, 1, "delta-operations")],
    }));
    if (archived && !currentMasterExists) {
      this.#diagnostics.push(diagnostic(
        "ARCHIVED_MASTER_SPEC_MISSING",
        ERROR,
        `Archived Change '${change.id}' has no current Master Spec for '${capability}'`,
        {
          elements: [deltaNodeId, affectsEdgeId, masterNodeId],
          source: source(file, 1, "capability"),
        },
      ));
    }
    if (operations.length === 0) {
      this.#diagnostics.push(diagnostic(
        "DELTA_OPERATIONS_MISSING",
        ERROR,
        `${file} has no configured Delta operation section`,
        {
          elements: [deltaNodeId, affectsEdgeId],
          source: source(file, 1, "delta-operations"),
        },
      ));
    }
    for (const duplicate of parsedOperations.duplicates) {
      this.#diagnostics.push(diagnostic(
        "DELTA_OPERATION_DUPLICATE",
        ERROR,
        `${file} repeats ${duplicate.operation} Requirements from line ${duplicate.firstLine}`,
        {
          elements: [deltaNodeId, affectsEdgeId],
          source: source(file, duplicate.line, `delta-operations.${duplicate.operation}`),
        },
      ));
    }
    for (const operation of operations) {
      addEdge(this.#edges, edge(
        `derived:${deltaNodeId}:${operation.operation}`,
        deltaNodeId,
        "changes",
        masterNodeId,
        {
          operation: operation.operation,
          provenance: [source(file, operation.line, `delta-operations.${operation.operation}`)],
        },
      ));
    }
  }

  /** Projects Change-to-Repository and Repository-to-Master relations. */
  async #projectRepositoryRelations() {
    const changes = [...this.#changeDefinitions.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const change of changes) await this.#projectChangeRelations(change);
  }

  /** Projects the Repository Impact declared by one Change. */
  async #projectChangeRelations(change) {
    if (change.capabilities.size === 0 && !change.skipSpecs) {
      this.#diagnostics.push(diagnostic(
        "CHANGE_WITHOUT_DELTA_SPECS",
        WARNING,
        `Change '${change.id}' has no Delta Specs`,
        {
          elements: [change.nodeId],
          source: source(change.path, 1, "specs"),
        },
      ));
    }
    const proposalPath = `${change.path}/proposal.md`;
    const proposal = await readOptionalFile(this.#root, proposalPath);
    const impact = proposal === null
      ? { present: false, entries: [], diagnostics: [] }
      : parseRepositoryImpact(proposal, proposalPath, change.id);
    this.#diagnostics.push(...impact.diagnostics.map((value) => ({
      ...value,
      elements: [...new Set([change.nodeId, ...value.elements])].sort(),
    })));
    if (!impact.present && change.capabilities.size > 0) {
      this.#diagnostics.push(diagnostic(
        "REPOSITORY_IMPACT_MISSING",
        WARNING,
        `Change '${change.id}' has Delta Specs but no Repository Impact table`,
        {
          elements: [change.nodeId],
          source: source(proposalPath, 1, "repository-impact"),
        },
      ));
    }

    const changeRepositoryEdges = new Map();
    for (const entry of impact.entries) {
      const repositoryNodeId = `repository:${entry.repositoryId}`;
      const changesEdgeId = `derived:${change.nodeId}:changes_in:${repositoryNodeId}`;
      let changesEdge = changeRepositoryEdges.get(repositoryNodeId);
      if (!changesEdge) {
        changesEdge = edge(changesEdgeId, change.nodeId, "changes_in", repositoryNodeId, {
          via_changes: [change.id],
        });
        changeRepositoryEdges.set(repositoryNodeId, changesEdge);
        addEdge(this.#edges, changesEdge);
      }
      addProvenance(changesEdge, entry.source, change.id);

      const validCapabilities = entry.capabilities.filter(({ id }) => (
        change.capabilities.has(id)
      ));
      const linkEdgeIds = validCapabilities.map(({ id }) => (
        `derived:${repositoryNodeId}:linked:master-spec:${id}`
      ));
      if (!this.#repositoryIds.has(entry.repositoryId)) {
        if (!this.#nodes.has(repositoryNodeId)) {
          this.#nodes.set(repositoryNodeId, node(
            repositoryNodeId,
            "repository",
            entry.repositoryId,
            {
              repository_id: entry.repositoryId,
              state: "missing",
              placeholder: true,
            },
          ));
        }
        this.#diagnostics.push(diagnostic(
          "GRAPH_UNKNOWN_REPOSITORY",
          ERROR,
          `Repository '${entry.repositoryId}' is absent from openspec-orch.yaml`,
          {
            elements: [repositoryNodeId, changesEdgeId, ...linkEdgeIds],
            source: entry.source,
          },
        ));
      }
      for (const capability of entry.capabilities) {
        if (!change.capabilities.has(capability.id)) {
          this.#diagnostics.push(diagnostic(
            "REPOSITORY_IMPACT_UNKNOWN_CAPABILITY",
            ERROR,
            `Capability '${capability.id}' has no Delta Spec in Change '${change.id}'`,
            {
              elements: [change.nodeId, changesEdgeId],
              source: capability.source,
            },
          ));
          continue;
        }
        const masterNodeId = `master-spec:${capability.id}`;
        const linkEdgeId = `derived:${repositoryNodeId}:linked:${masterNodeId}`;
        let linkEdge = this.#edges.get(linkEdgeId);
        if (!linkEdge) {
          linkEdge = edge(linkEdgeId, repositoryNodeId, "linked", masterNodeId, {
            via_changes: [],
          });
          addEdge(this.#edges, linkEdge);
        }
        addProvenance(linkEdge, capability.source, change.id);
        this.#linkedCapabilities.add(capability.id);
      }
    }
  }

  /** Marks every Master Spec that has no active or archived Repository evidence. */
  #diagnoseUnlinkedMasterSpecs() {
    for (const master of [...this.#nodes.values()].filter(({ type }) => type === "master-spec")) {
      if (this.#linkedCapabilities.has(master.capability)) continue;
      this.#diagnostics.push(diagnostic(
        "UNLINKED_MASTER_SPEC",
        WARNING,
        `Master Spec '${master.capability}' has no known Repository relation`,
        {
          elements: [master.id],
          source: master.path ? source(master.path, 1, "capability") : undefined,
        },
      ));
    }
  }
}

/** Compiles a deterministic graph report from the current Store checkout. */
export async function compileOpenSpecGraph(projectRoot, { repositories = [], storeId } = {}) {
  const root = await fs.realpath(projectRoot);
  if (!Array.isArray(repositories)) fatal("repositories must be an array");
  if (typeof storeId !== "string" || storeId.trim().length === 0) {
    fatal("storeId must be a non-empty string");
  }
  for (const repository of repositories) {
    if (!repository || typeof repository.id !== "string" || repository.role !== "code") {
      fatal("repositories must contain code repository handles");
    }
  }

  const operationConfig = await operationHeadingConfig(root);
  return new GraphCompilation(root, repositories, storeId, operationConfig).compile();
}
