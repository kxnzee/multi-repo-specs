/** @fileoverview OpenSpec Graph package, projection and viewer contract. */

/* global fetch */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin from "../index.js";
import { buildOpenSpecGraph } from "../lib/builder.js";
import { checkChangeScope, inspectChangeImpact, inspectGraphNode } from "../lib/query.js";
import { startGraphViewer } from "../lib/viewer.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/** Creates a disposable Store-like tree. */
async function storeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-graph-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    "openspec/specs/conference/visitors/spec.md": [
      "## Purpose",
      "",
      "Visitor behavior.",
      "",
      "## Requirements",
      "",
      "### Requirement: Existing behavior",
      "The system SHALL preserve it.",
      "",
      "#### Scenario: Existing behavior",
      "- **WHEN** it runs",
      "- **THEN** it remains",
      "",
    ].join("\n"),
    "openspec/specs/conference/agenda/spec.md": [
      "## Purpose",
      "",
      "Conference agenda behavior.",
      "",
      "## Requirements",
      "",
      "### Requirement: Publish an agenda",
      "The system SHALL publish an agenda for registered visitors.",
      "",
      "#### Scenario: Published agenda",
      "- **WHEN** a visitor opens the conference",
      "- **THEN** the agenda is available",
      "",
    ].join("\n"),
    "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md": [
      "## MODIFIED Requirements",
      "",
      "### Requirement: Existing behavior",
      "The system SHALL extend it.",
      "",
      "#### Scenario: Extended behavior",
      "- **WHEN** it runs",
      "- **THEN** it extends",
      "",
    ].join("\n"),
    "openspec/graph.yaml": [
      "version: 1",
      "edges:",
      "  - source: repository:web",
      "    relation: depends_on",
      "    target: repository:control",
      "    contract: Conference control",
      "    sources:",
      "      - docs/architecture.md:12",
      "      - docs/architecture.toml:1",
      "  - source: repository:portal",
      "    relation: calls",
      "    target: repository:web",
      "    contract: Visitor API",
      "    sources:",
      "      - docs/architecture.md:13",
      "  - source: repository:web",
      "    relation: publishes_to",
      "    target: repository:notifications",
      "    contract: Visitor events",
      "    sources:",
      "      - docs/architecture.md:14",
      "  - source: master-spec:conference/visitors",
      "    relation: implemented_by",
      "    target: repository:web",
      "    sources:",
      "      - openspec/specs/conference/visitors/spec.md:1",
      "  - source: repository:qa",
      "    relation: verifies",
      "    target: master-spec:conference/visitors",
      "    sources:",
      "      - docs/architecture.md:15",
      "  - source: master-spec:conference/agenda",
      "    relation: depends_on",
      "    target: master-spec:conference/visitors",
      "    sources:",
      "      - docs/architecture.md:2",
      "  - source: master-spec:conference/agenda",
      "    relation: implemented_by",
      "    target: repository:control",
      "    sources:",
      "      - openspec/specs/conference/agenda/spec.md:1",
      "  - source: delta-spec:jit-100-promote/conference/visitors",
      "    relation: targets",
      "    target: repository:web",
      "    sources:",
      "      - openspec/changes/jit-100-promote/design.md:20",
      "",
    ].join("\n"),
    "docs/architecture.md": Array.from(
      { length: 24 },
      (_, index) => `Architecture evidence ${index + 1}`,
    ).join("\n"),
    "docs/architecture.toml": "service = \"conference\"\n",
    "openspec/changes/jit-100-promote/design.md": Array.from(
      { length: 24 },
      (_, index) => `Design evidence ${index + 1}`,
    ).join("\n"),
    "openspec/changes/empty-change/proposal.md": "# Empty Change\n",
  };
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
  }
  return root;
}

const repositories = [
  { id: "control", role: "code" },
  { id: "notifications", role: "code" },
  { id: "portal", role: "code" },
  { id: "qa", role: "code" },
  { id: "web", role: "code" },
];
const storeId = "specs";

test("Package exposes a Store-only bundled Plugin contract", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  assert.equal(packageManifest.name, "@openspec-orch/plugin-openspec-graph");
  assert.deepEqual(packageManifest.openspecOrchestrator, {
    apiVersion: 1,
    plugin: "./index.js",
  });
  assert.deepEqual(assertPluginContract({ plugin, packageManifest }), {
    id: "openspec-graph",
    commands: ["graph"],
  });
  assert.deepEqual(plugin.supports, ["store"]);
  assert.equal(plugin.canExec(), true);
});

test("Plugin exec runs the registered graph command grammar with native options", async (t) => {
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  const graph = {
    graph_version: 1,
    source_digest: "a".repeat(64),
    nodes: [{ id: "store:specs" }],
    edges: [],
  };
  const context = Object.freeze({
    repository: Object.freeze({ id: "specs", role: "store" }),
    project: Object.freeze({
      id: "specs",
      repositories: Object.freeze([Object.freeze({ id: "specs", role: "store" })]),
    }),
    process: Object.freeze({
      run() { return Promise.resolve(JSON.stringify(graph)); },
    }),
    storage: Object.freeze({
      read() { return Promise.resolve(graph); },
    }),
  });

  await plugin.exec(context, ["graph", "status", "--json"]);
  await plugin.exec(context, ["graph", "status"]);

  assert.equal(output.length, 5);
  assert.equal(JSON.parse(output[0]).state, "ready");
  assert.deepEqual(output.slice(1), [
    "✓ OpenSpec Graph — готов и актуален",
    "  Узлы: 1  Рёбра: 0",
    `  Текущий digest: ${"a".repeat(12)}`,
    `  Сохранённый digest: ${"a".repeat(12)}`,
  ]);
});

test("Builder projects the Store hierarchy and strict graph edges", async (t) => {
  const root = await storeFixture(t);
  const first = await buildOpenSpecGraph(root, { repositories, storeId });
  const second = await buildOpenSpecGraph(root, { repositories, storeId });

  assert.deepEqual(second, first);
  assert.equal(first.graph_version, 1);
  assert.equal(first.nodes.length, 11);
  assert.deepEqual(first.nodes.map(({ id }) => id), [
    "change:empty-change",
    "change:jit-100-promote",
    "delta-spec:jit-100-promote/conference/visitors",
    "master-spec:conference/agenda",
    "master-spec:conference/visitors",
    "repository:control",
    "repository:notifications",
    "repository:portal",
    "repository:qa",
    "repository:web",
    "store:specs",
  ].sort());
  assert.equal(first.edges.length, 16);
  assert.deepEqual(
    first.edges.filter(({ relation }) => relation === "contains")
      .map(({ source, target }) => [source, target]),
    [
      ["change:jit-100-promote", "delta-spec:jit-100-promote/conference/visitors"],
      ["store:specs", "repository:control"],
      ["store:specs", "repository:notifications"],
      ["store:specs", "repository:portal"],
      ["store:specs", "repository:qa"],
      ["store:specs", "repository:web"],
    ],
  );
  assert.deepEqual(
    first.edges.find(({ relation }) => relation === "affects"),
    {
      id: "derived:change:jit-100-promote:affects:master-spec:conference/visitors",
      source: "change:jit-100-promote",
      relation: "affects",
      target: "master-spec:conference/visitors",
      operations: ["MODIFIED"],
      provenance: [
        "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md:1",
      ],
      derived: true,
    },
  );
  assert.deepEqual(
    first.edges.find(({ relation }) => relation === "changes"),
    {
      id: "derived:delta-spec:jit-100-promote/conference/visitors:MODIFIED:1",
      source: "delta-spec:jit-100-promote/conference/visitors",
      relation: "changes",
      target: "master-spec:conference/visitors",
      operation: "MODIFIED",
      provenance: [
        "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md:1",
      ],
      derived: true,
    },
  );
});

test("Builder fails closed for dangling graph references", async (t) => {
  const root = await storeFixture(t);
  const graphPath = path.join(root, "openspec/graph.yaml");
  await fs.writeFile(graphPath, [
    "version: 1",
    "edges:",
    "  - source: repository:missing",
    "    relation: depends_on",
    "    target: repository:web",
    "    sources: [docs/architecture.md:1]",
    "",
  ].join("\n"));
  await assert.rejects(
    buildOpenSpecGraph(root, { repositories, storeId }),
    /source does not exist: repository:missing/,
  );
});

test("Builder rejects unverifiable explicit-edge provenance", async (t) => {
  const root = await storeFixture(t);
  const graphPath = path.join(root, "openspec/graph.yaml");
  await fs.writeFile(graphPath, [
    "version: 1",
    "edges:",
    "  - source: repository:control",
    "    relation: depends_on",
    "    target: repository:web",
    "    sources: [docs/missing.md:1]",
    "",
  ].join("\n"));
  await assert.rejects(
    buildOpenSpecGraph(root, { repositories, storeId }),
    /source does not exist: docs\/missing.md/,
  );
});

test("Source digest tracks topology inputs rather than every Change file", async (t) => {
  const root = await storeFixture(t);
  const initial = await buildOpenSpecGraph(root, { repositories, storeId });

  await fs.writeFile(
    path.join(root, "openspec/changes/empty-change/proposal.md"),
    "# Revised proposal without topology changes\n",
  );
  await fs.writeFile(
    path.join(root, "openspec/changes/empty-change/tasks.md"),
    "- [x] Documentation-only task state\n",
  );
  const planningOnly = await buildOpenSpecGraph(root, { repositories, storeId });
  assert.equal(planningOnly.source_digest, initial.source_digest);

  await fs.appendFile(
    path.join(root, "openspec/specs/conference/visitors/spec.md"),
    "\nTopology input changed.\n",
  );
  const changedMasterSpec = await buildOpenSpecGraph(root, { repositories, storeId });
  assert.notEqual(changedMasterSpec.source_digest, initial.source_digest);
});

test("Builder projects an archived Change without retaining an active duplicate", async (t) => {
  const root = await storeFixture(t);
  const activePath = path.join(root, "openspec/changes/jit-100-promote");
  const archivePath = path.join(root, "openspec/changes/archive/2026-08-25-jit-100-promote");
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.rename(activePath, archivePath);

  const graph = await buildOpenSpecGraph(root, { repositories, storeId });
  const changes = graph.nodes.filter(({ id }) => id === "change:jit-100-promote");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, "archived");
  assert.equal(changes[0].path, "openspec/changes/archive/2026-08-25-jit-100-promote");
  assert.equal(
    graph.nodes.find(({ id }) => (
      id === "delta-spec:jit-100-promote/conference/visitors"
    )).state,
    "archived",
  );
});

test("Read queries separate direct and downstream Change impact", async (t) => {
  const root = await storeFixture(t);
  const graph = await buildOpenSpecGraph(root, { repositories, storeId });
  const nodeView = inspectGraphNode(graph, "master-spec:conference/visitors");
  assert.equal(nodeView.node.type, "master-spec");
  assert.deepEqual(nodeView.neighbors.map(({ id }) => id), [
    "change:jit-100-promote",
    "delta-spec:jit-100-promote/conference/visitors",
    "master-spec:conference/agenda",
    "repository:qa",
    "repository:web",
  ]);

  const impact = inspectChangeImpact(graph, "jit-100-promote");
  assert.equal(impact.change.id, "change:jit-100-promote");
  assert.deepEqual(impact.direct_master_specs.map(({ id }) => id), [
    "master-spec:conference/visitors",
  ]);
  assert.deepEqual(impact.dependent_master_specs.map(({ id }) => id), [
    "master-spec:conference/agenda",
  ]);
  assert.deepEqual(impact.total_master_specs.map(({ id }) => id), [
    "master-spec:conference/agenda",
    "master-spec:conference/visitors",
  ]);
  assert.deepEqual(impact.direct_repositories.map(({ id }) => id), ["repository:web"]);
  assert.deepEqual(impact.dependent_repositories.map(({ id }) => id), [
    "repository:control",
  ]);
  assert.deepEqual(impact.repositories.map(({ id }) => id), [
    "repository:control",
    "repository:web",
  ]);
  assert.deepEqual(impact.verification_repositories.map(({ id }) => id), [
    "repository:qa",
  ]);
  assert.deepEqual(impact.related_repositories.map(({ id }) => id), [
    "repository:portal",
  ]);
  assert.deepEqual(impact.review_repositories.map(({ id }) => id), [
    "repository:portal",
    "repository:qa",
  ]);
  assert.deepEqual(impact.all_repositories.map(({ id }) => id), [
    "repository:control",
    "repository:portal",
    "repository:qa",
    "repository:web",
  ]);
  assert.deepEqual(impact.edges.map(({ relation }) => relation), [
    "affects",
    "contains",
    "changes",
    "depends_on",
    "calls",
    "implemented_by",
    "verifies",
    "depends_on",
    "implemented_by",
    "targets",
  ]);
  assert.throws(() => inspectChangeImpact(graph, "missing"), /CHANGE_NOT_FOUND/);
  const emptyImpact = inspectChangeImpact(graph, "empty-change");
  assert.deepEqual(emptyImpact.delta_specs, []);
  assert.deepEqual(emptyImpact.direct_master_specs, []);
  assert.deepEqual(emptyImpact.dependent_master_specs, []);
  assert.deepEqual(emptyImpact.total_master_specs, []);
  assert.deepEqual(emptyImpact.verification_repositories, []);
  assert.deepEqual(emptyImpact.related_repositories, []);
  assert.deepEqual(emptyImpact.review_repositories, []);
  assert.deepEqual(emptyImpact.all_repositories, []);
});

test("Repository impact follows the declared direction of each relation", () => {
  const impactFor = (relation, implementationRepository) => inspectChangeImpact({
    nodes: [
      { id: "change:direction", type: "change", change_id: "direction" },
      {
        id: "delta-spec:direction/example",
        type: "delta-spec",
        change_id: "direction",
      },
      { id: "master-spec:example", type: "master-spec", capability: "example" },
      { id: "repository:source", type: "repository", repository_id: "source" },
      { id: "repository:target", type: "repository", repository_id: "target" },
    ],
    edges: [
      {
        id: "contains",
        source: "change:direction",
        relation: "contains",
        target: "delta-spec:direction/example",
      },
      {
        id: "changes",
        source: "delta-spec:direction/example",
        relation: "changes",
        target: "master-spec:example",
      },
      {
        id: "implements",
        source: "master-spec:example",
        relation: "implemented_by",
        target: `repository:${implementationRepository}`,
      },
      {
        id: relation,
        source: "repository:source",
        relation,
        target: "repository:target",
      },
    ],
  }, "direction").related_repositories.map(({ repository_id: repositoryId }) => repositoryId);

  assert.deepEqual(impactFor("depends_on", "source"), []);
  assert.deepEqual(impactFor("depends_on", "target"), ["source"]);
  assert.deepEqual(impactFor("calls", "source"), []);
  assert.deepEqual(impactFor("calls", "target"), ["source"]);
  assert.deepEqual(impactFor("publishes_to", "source"), []);
  assert.deepEqual(impactFor("publishes_to", "target"), []);
});

test("Change impact separates direct and transitive prerequisites and dependents", () => {
  const changeIds = ["a", "b", "c", "d", "e"];
  const graph = {
    nodes: [
      ...changeIds.flatMap((changeId) => [
        { id: `change:${changeId}`, type: "change", change_id: changeId },
        {
          id: `delta-spec:${changeId}/example`,
          type: "delta-spec",
          change_id: changeId,
        },
      ]),
      { id: "master-spec:example", type: "master-spec", capability: "example" },
    ],
    edges: [
      ...changeIds.map((changeId) => ({
        id: `contains:${changeId}`,
        source: `change:${changeId}`,
        relation: "contains",
        target: `delta-spec:${changeId}/example`,
      })),
      {
        id: "changes:a",
        source: "delta-spec:a/example",
        relation: "changes",
        target: "master-spec:example",
      },
      {
        id: "a-needs-b",
        source: "delta-spec:a/example",
        relation: "depends_on",
        target: "delta-spec:b/example",
      },
      {
        id: "b-needs-d",
        source: "delta-spec:b/example",
        relation: "depends_on",
        target: "delta-spec:d/example",
      },
      {
        id: "c-needs-a",
        source: "delta-spec:c/example",
        relation: "depends_on",
        target: "delta-spec:a/example",
      },
      {
        id: "e-needs-c",
        source: "delta-spec:e/example",
        relation: "depends_on",
        target: "delta-spec:c/example",
      },
    ],
  };

  const impact = inspectChangeImpact(graph, "a");
  assert.deepEqual(impact.prerequisite_changes.direct.map(({ change_id: id }) => id), ["b"]);
  assert.deepEqual(impact.prerequisite_changes.transitive.map(({ change_id: id }) => id), ["d"]);
  assert.deepEqual(impact.dependent_changes.direct.map(({ change_id: id }) => id), ["c"]);
  assert.deepEqual(impact.dependent_changes.transitive.map(({ change_id: id }) => id), ["e"]);
});

test("Scope check separates required, review and extra Cycle repositories", async (t) => {
  const root = await storeFixture(t);
  const graph = await buildOpenSpecGraph(root, { repositories, storeId });
  const graphWithExtraRepository = Object.freeze({
    ...graph,
    nodes: Object.freeze([
      ...graph.nodes,
      Object.freeze({
        id: "repository:operations",
        type: "repository",
        label: "operations",
        repository_id: "operations",
      }),
    ].sort((left, right) => left.id.localeCompare(right.id))),
  });

  assert.deepEqual(checkChangeScope(
    graphWithExtraRepository,
    "jit-100-promote",
    ["qa", "web", "operations"],
  ), {
    change_id: "jit-100-promote",
    state: "invalid",
    proposed_repositories: ["operations", "qa", "web"],
    required_repositories: ["web"],
    review_repositories: ["control", "portal", "qa"],
    missing_required_repositories: [],
    included_review_repositories: ["qa"],
    review_repositories_outside_scope: ["control", "portal"],
    extra_repositories: ["operations"],
    missing_delta_specs: false,
    unmapped_master_specs: [],
  });

  assert.equal(
    checkChangeScope(graph, "jit-100-promote", ["web", "qa"]).state,
    "invalid",
  );
  assert.deepEqual(
    checkChangeScope(graph, "jit-100-promote", ["web", "qa"])
      .included_review_repositories,
    ["qa"],
  );
  assert.equal(checkChangeScope(graph, "jit-100-promote", ["web"]).state, "ready");

  assert.equal(checkChangeScope(graph, "jit-100-promote", ["qa"]).state, "invalid");
  assert.deepEqual(
    checkChangeScope(graph, "jit-100-promote", ["qa"]).missing_required_repositories,
    ["web"],
  );
  assert.equal(checkChangeScope(graph, "empty-change", ["web"]).state, "invalid");
  assert.equal(checkChangeScope(graph, "empty-change", ["web"]).missing_delta_specs, true);
  assert.throws(
    () => checkChangeScope(graph, "jit-100-promote", ["missing"]),
    /REPOSITORY_NOT_FOUND: missing/u,
  );
  assert.throws(
    () => checkChangeScope(graph, "jit-100-promote", ["web", "web"]),
    /SCOPE_INVALID.*duplicate/u,
  );

  const unmappedGraph = Object.freeze({
    ...graph,
    edges: Object.freeze(graph.edges.filter(({ relation }) => (
      relation !== "implemented_by" && relation !== "targets"
    ))),
  });
  const unmapped = checkChangeScope(unmappedGraph, "jit-100-promote", ["web"]);
  assert.equal(unmapped.state, "invalid");
  assert.deepEqual(unmapped.unmapped_master_specs, ["conference/visitors"]);
});

test("Viewer serves graph and vendored vis-network only on loopback", async (t) => {
  const root = await storeFixture(t);
  const graph = await buildOpenSpecGraph(root, { repositories, storeId });
  const viewer = await startGraphViewer(graph, {
    port: 0,
    readSource: (relativePath) => fs.readFile(path.join(root, relativePath), "utf8"),
    sourceRoot: root,
  });
  t.after(() => viewer.close());

  assert.match(viewer.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
  const page = await fetch(viewer.url);
  const markup = await page.text();
  assert.doesNotMatch(markup, /id="layout-mode"/u);
  assert.doesNotMatch(markup, /id="relation-filter"/u);
  assert.match(markup, /id="node-type-filters"/u);
  assert.match(markup, /id="layers-menu"/u);
  assert.match(markup, /id="layer-count">3\/4/u);
  assert.doesNotMatch(markup, /id="lane-guide"/u);
  assert.match(markup, /Репозиторий/u);
  assert.match(markup, /Мастер-спека/u);
  assert.match(markup, /Изменение/u);
  assert.match(markup, /value="repository" checked/u);
  assert.match(markup, /value="master-spec" checked/u);
  assert.match(markup, /value="change" checked/u);
  assert.doesNotMatch(markup, /value="delta-spec" checked/u);
  assert.match(markup, /Дельта-спека/u);
  assert.match(markup, /id="reset-view"/u);
  assert.doesNotMatch(markup, /id="stabilize"/u);
  assert.match(page.headers.get("content-security-policy"), /style-src 'self' 'unsafe-inline'/u);
  const application = await fetch(`${viewer.url}/app.js`).then((response) => response.text());
  assert.doesNotMatch(application, /function lanePositions/u);
  assert.doesNotMatch(application, /function syncLaneGuide/u);
  assert.match(application, /function isMasterDependency/u);
  assert.match(application, /import \{ inspectChangeImpact \} from "\/graph-query\.js"/u);
  assert.match(application, /function impactForChange/u);
  assert.match(application, /impact\.review_repositories/u);
  assert.match(application, /Репозитории для проверки связей/u);
  assert.match(application, /function expandChange/u);
  assert.match(application, /function enabledNodeTypes/u);
  assert.match(application, /function syncLayerCount/u);
  assert.match(application, /function appendFileDetail/u);
  assert.match(application, /function createFileControl/u);
  assert.match(application, /function createEntityName/u);
  assert.match(application, /function createEntityArrow/u);
  assert.match(application, /function appendExpandableItems/u);
  assert.match(application, /className = "details-more-button"/u);
  assert.match(application, /const evidenceActions/u);
  assert.match(application, /navigator\.clipboard\.writeText/u);
  assert.match(application, /menu\.append\(copyPath\)/u);
  assert.match(application, /function positionAllDeltaClusters/u);
  assert.match(application, /function positionExpandedDeltas/u);
  assert.match(application, /filterableNodeTypes = \["repository", "master-spec", "change", "delta-spec"\]/u);
  assert.match(application, /const radius = 58 \+ Math\.sqrt\(index \+ 1\) \* 26/u);
  assert.doesNotMatch(
    application,
    /edge\.relation !== "affects" && edge\.relation !== "targets"/u,
  );
  assert.match(
    application,
    /if \(edge\.relation === "affects"\) return !hasVisibleDeltaPath\(edge\)/u,
  );
  assert.doesNotMatch(application, /edge\.relation !== "targets" \|\| focusedEdgeIds\.has/u);
  assert.match(application, /visibleNodeIds\.add\(id\)/u);
  assert.doesNotMatch(application, /changePosition\.x \+ dx \* 0\.48/u);
  assert.match(application, /Прямые Master Specs/u);
  assert.match(application, /Зависимое влияние/u);
  assert.match(application, /solver: "forceAtlas2Based"/u);
  assert.match(application, /stabilizationIterationsDone/u);
  assert.match(application, /network\.moveNode/u);
  assert.match(application, /smooth: false/u);
  assert.doesNotMatch(application, /type: "dynamic"/u);
  assert.match(application, /function structuralChildren/u);
  assert.match(application, /requestAnimationFrame\(applyDragFollowers\)/u);
  assert.match(application, /cancelAnimationFrame\(dragState\.frameId\)/u);
  assert.match(application, /edge\.relation === "implemented_by"/u);
  assert.match(application, /edge\.relation === "contains"/u);
  assert.match(application, /physics: \{/u);
  assert.match(application, /enabled: true/u);
  assert.match(application, /network\.setOptions\(\{ physics: \{ enabled: false \} \}\)/u);
  assert.doesNotMatch(application, /\.stabilize\(/u);
  const document = await fetch(`${viewer.url}/graph.json`).then((response) => response.json());
  assert.equal(document.source_digest, graph.source_digest);
  const queryModule = await fetch(`${viewer.url}/graph-query.js`);
  assert.equal(queryModule.status, 200);
  assert.match(await queryModule.text(), /export function inspectChangeImpact/u);
  const viewerConfig = await fetch(`${viewer.url}/viewer-config.json`)
    .then((response) => response.json());
  assert.equal(viewerConfig.sources["change:jit-100-promote"], undefined);
  const sourceNode = graph.nodes.find(({ type }) => type === "master-spec");
  const sourceAction = viewerConfig.sources[sourceNode.id];
  assert.match(sourceAction.preview_url, /^\/source\//u);
  assert.match(sourceAction.ide_url, /^vscode:\/\/file\//u);
  const sourceResponse = await fetch(`${viewer.url}${sourceAction.preview_url}`);
  assert.equal(sourceResponse.status, 200);
  assert.match(sourceResponse.headers.get("content-type"), /text\/plain/u);
  assert.match(await sourceResponse.text(), /## Requirements/u);
  const evidenceReference = graph.edges
    .flatMap(({ provenance }) => provenance)
    .find(Boolean);
  const evidenceAction = viewerConfig.evidence[evidenceReference];
  assert.equal(evidenceAction.line, Number(evidenceReference.split(":").at(-1)));
  assert.match(evidenceAction.ide_url, new RegExp(`:${evidenceAction.line}$`, "u"));
  const evidenceResponse = await fetch(`${viewer.url}${evidenceAction.preview_url}`);
  assert.equal(evidenceResponse.status, 200);
  assert.match(evidenceResponse.headers.get("content-type"), /text\/plain/u);
  const tomlReference = "docs/architecture.toml:1";
  const tomlAction = viewerConfig.evidence[tomlReference];
  assert.equal(tomlAction.path, "docs/architecture.toml");
  const tomlResponse = await fetch(`${viewer.url}${tomlAction.preview_url}`);
  assert.equal(tomlResponse.status, 200);
  assert.match(await tomlResponse.text(), /service = "conference"/u);
  const missingSource = await fetch(`${viewer.url}/source/${encodeURIComponent("store:test")}`);
  assert.equal(missingSource.status, 404);
  const vendor = await fetch(`${viewer.url}/vendor/vis-network.min.js`);
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get("content-type"), /text\/javascript/u);
  const vendorStyles = await fetch(`${viewer.url}/vendor/vis-network.min.css`);
  assert.equal(vendorStyles.status, 200);
  assert.match(vendorStyles.headers.get("content-type"), /text\/css/u);
  const favicon = await fetch(`${viewer.url}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/svg+xml");
  assert.equal((await fetch(`${viewer.url}/favicon.ico`)).status, 200);
});

test("Repository connect is planning-safe and explicit sync validates and builds", async () => {
  const calls = [];
  let stored = null;
  const graph = {
    graph_version: 1,
    source_digest: "a".repeat(64),
    nodes: [{ id: "repository:web" }],
    edges: [],
  };
  const context = Object.freeze({
    project: Object.freeze({
      id: "specs",
      repositories: Object.freeze([
        Object.freeze({ id: "specs", role: "store" }),
        Object.freeze({ id: "web", role: "code" }),
      ]),
    }),
    process: Object.freeze({
      run(executable, args) {
        calls.push([executable, args]);
        return Promise.resolve(executable === process.execPath ? JSON.stringify(graph) : "{}");
      },
    }),
    storage: Object.freeze({
      read() { return Promise.resolve(stored); },
      write(value) { stored = value; return Promise.resolve(value); },
    }),
  });

  assert.equal(
    await plugin.connect(context),
    "OpenSpec Graph подключён; выполните openspec-orch graph build",
  );
  assert.equal(stored, null);
  assert.deepEqual(calls, []);
  assert.equal((await plugin.status(context)).state, "unavailable");

  assert.equal(await plugin.sync(context), `1 nodes, 0 edges, digest ${"a".repeat(12)}`);
  assert.deepEqual(stored, graph);
  assert.equal(calls[0][0], "openspec");
  assert.deepEqual(calls[0][1], [
    "validate", "--all", "--strict", "--no-interactive", "--json",
  ]);
  assert.equal(calls[1][0], process.execPath);
  assert.deepEqual(calls[1][1].slice(0, 5), [
    calls[1][1][0], "build", ".", "--store-id", "specs",
  ]);
  assert.deepEqual(await plugin.status(context), {
    state: "ready",
    authoritative: true,
    reason: null,
    stored_digest: graph.source_digest,
    current_digest: graph.source_digest,
    last_known_good_available: true,
    nodes: 1,
    edges: 0,
    next_command: null,
    details: JSON.stringify({
      stored_digest: graph.source_digest,
      current_digest: graph.source_digest,
      nodes: 1,
      edges: 0,
    }),
  });
});

test("Repository status reports recovery guidance without exposing stale data as authoritative", async () => {
  let stored = null;
  let projectedDigest = "a".repeat(64);
  let projectionError = null;
  const context = Object.freeze({
    project: Object.freeze({
      id: "specs",
      repositories: Object.freeze([Object.freeze({ id: "web", role: "code" })]),
    }),
    process: Object.freeze({
      run(executable) {
        if (executable === "openspec") return Promise.resolve("{}");
        if (projectionError) return Promise.reject(projectionError);
        return Promise.resolve(JSON.stringify({
          graph_version: 1,
          source_digest: projectedDigest,
          nodes: [{ id: "repository:web" }],
          edges: [],
        }));
      },
    }),
    storage: Object.freeze({
      read() { return Promise.resolve(stored); },
      write(value) { stored = value; return Promise.resolve(value); },
    }),
  });

  assert.deepEqual(await plugin.status(context), {
    state: "unavailable",
    authoritative: false,
    reason: "GRAPH_NOT_BUILT",
    stored_digest: null,
    current_digest: null,
    last_known_good_available: false,
    nodes: 0,
    edges: 0,
    next_command: "openspec-orch graph build",
    details: JSON.stringify({ reason: "GRAPH_NOT_BUILT" }),
  });

  await plugin.connect(context);
  assert.equal((await plugin.status(context)).state, "unavailable");
  await plugin.sync(context);
  const ready = await plugin.status(context);
  assert.equal(ready.state, "ready");
  assert.equal(ready.authoritative, true);
  assert.equal(ready.next_command, null);

  projectedDigest = "b".repeat(64);
  const stale = await plugin.status(context);
  assert.equal(stale.state, "stale");
  assert.equal(stale.authoritative, false);
  assert.equal(stale.reason, "SOURCE_DIGEST_CHANGED");
  assert.equal(stale.last_known_good_available, true);
  assert.equal(stale.next_command, "openspec-orch graph build");

  projectionError = new Error("OPENSPEC_GRAPH_INVALID: broken inputs");
  const invalid = await plugin.status(context);
  assert.equal(invalid.state, "invalid");
  assert.equal(invalid.authoritative, false);
  assert.equal(invalid.reason, "CURRENT_INPUTS_INVALID");
  assert.equal(invalid.last_known_good_available, true);
  assert.equal(stored.source_digest, "a".repeat(64));

  await assert.rejects(plugin.sync(context), /OPENSPEC_GRAPH_INVALID/u);
  assert.equal(stored.source_digest, "a".repeat(64));

  projectionError = null;
  await plugin.sync(context);
  const rebuilt = await plugin.status(context);
  assert.equal(rebuilt.state, "ready");
  assert.equal(rebuilt.authoritative, true);
  assert.equal(rebuilt.stored_digest, "b".repeat(64));
  assert.equal(rebuilt.current_digest, "b".repeat(64));
});
