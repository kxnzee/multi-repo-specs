/** @fileoverview Stateless OpenSpec Graph compiler and Plugin command contract. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin from "../index.js";
import { openSpecGraphAgentContribution } from "../lib/agent.js";
import { OpenSpecGraphApplication } from "../lib/application.js";
import { compileOpenSpecGraph } from "../lib/builder.js";
import { runGraphView } from "../lib/commands.js";
import { archivedChangeId } from "../lib/compiler-input.js";
import { parseDeltaOperations } from "../lib/operation-headings.js";
import { inspectChangeImpact, inspectGraphNode } from "../lib/query.js";
import { startGraphViewer } from "../lib/viewer.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repositories = [
  { id: "control", role: "code" },
  { id: "web", role: "code" },
];
const storeId = "specs";

test("Agent Change context projects assignment from one Graph impact query", async () => {
  let queries = 0;
  const graphImpact = Object.freeze({
    change_id: "pay",
    repositories: Object.freeze([
      Object.freeze({ id: "repository:frontend" }),
    ]),
  });
  const result = Object.freeze({
    current_repository: Object.freeze({ repository_id: "frontend", role: "code" }),
    assignment_scope: Object.freeze({
      assigned: null,
      assignments: Object.freeze([
        Object.freeze({ repository_id: "frontend", assigned: null }),
        Object.freeze({ repository_id: "backend", assigned: null }),
      ]),
      current_assignment: Object.freeze({ repository_id: "frontend" }),
    }),
  });
  const enhanced = await openSpecGraphAgentContribution.enhance({
    application: Object.freeze({
      async query(query, changeId) {
        queries += 1;
        assert.equal(query, "change_impact");
        assert.equal(changeId, "pay");
        return graphImpact;
      },
    }),
    input: Object.freeze({ change_id: "pay", include_assignment: true }),
    operation: "getChangeContext",
    result,
  });

  assert.equal(queries, 1);
  assert.equal(enhanced.graph_impact, graphImpact);
  assert.equal(enhanced.assignment_scope.assigned, true);
  assert.deepEqual(enhanced.assignment_scope.assignments.map(({ repository_id, assigned }) => ({
    repository_id,
    assigned,
  })), [
    { repository_id: "frontend", assigned: true },
    { repository_id: "backend", assigned: false },
  ]);
});

test("archived Change directories require the canonical date prefix", () => {
  assert.equal(archivedChangeId("2026-08-27-jit-100-promote"), "jit-100-promote");
  assert.equal(archivedChangeId("jit-100-promote"), null);
  assert.equal(archivedChangeId("2026-08-27-"), null);
});

/** Writes one Store-relative file and its parents. */
async function write(root, relativePath, source) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source);
}

/** Creates a disposable Store tree with one linked and one unlinked capability. */
async function storeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-graph-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, "openspec-orch.yaml", [
    "version: 1",
    "repositories:",
    "  - id: control",
    "    roles: [code]",
    "  - id: web",
    "    roles: [code]",
    "",
  ].join("\n"));
  await write(root, "openspec/specs/conference/visitors/spec.md", [
    "## Purpose",
    "",
    "Visitor behavior.",
    "",
    "## Requirements",
    "",
  ].join("\n"));
  await write(root, "openspec/specs/conference/agenda/spec.md", [
    "## Purpose",
    "",
    "Agenda behavior.",
    "",
    "## Requirements",
    "",
  ].join("\n"));
  await write(root, "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md", [
    "## MODIFIED Requirements",
    "",
    "### Requirement: Existing behavior",
    "The system SHALL extend it.",
    "",
  ].join("\n"));
  await write(root, "openspec/changes/jit-100-promote/proposal.md", [
    "# Promote visitors",
    "",
    "## Repository Impact",
    "",
    "| Repository | Capabilities |",
    "| --- | --- |",
    "| `web` | `conference/visitors` |",
    "",
  ].join("\n"));
  await write(root, "openspec/changes/empty-change/.openspec.yaml", "skip_specs: true\n");
  await write(root, "openspec/changes/empty-change/proposal.md", "# Tooling-only Change\n");
  return root;
}

test("Assignment scope distinguishes unknown Impact from confirmed nonparticipation", async (t) => {
  const root = await storeFixture(t);
  const changeId = "jit-100-promote";
  const proposalPath = `openspec/changes/${changeId}/proposal.md`;
  const header = "## Repository Impact\n\n| Repository | Capabilities |\n| --- | --- |\n";
  const valid = `${header}| web | conference/visitors |\n`;
  const application = new OpenSpecGraphApplication({}, {
    service: { compile: () => compileOpenSpecGraph(root, { repositories, storeId }) },
  });
  const result = {
    assigned: null,
    current_repository: { repository_id: "web", role: "code" },
    assignments: repositories.map(({ id }) => ({ repository_id: id, assigned: null })),
  };
  for (const [name, proposal, expected] of [
    ["missing table", "# Proposal\n", [null, null]],
    ["invalid table", "## Repository Impact\n- web\n", [null, null]],
    ["empty table", header, [null, null]],
    ["partially invalid table", `${valid}| control | |\n`, [null, null]],
    ["duplicate section", `${valid}\n${valid}`, [null, null]],
    ["duplicate mapping", `${valid}| web | conference/visitors |\n`, [null, null]],
    ["unknown repository", `${valid}| unknown | conference/visitors |\n`, [null, null]],
    ["unknown capability", `${header}| web | unknown |\n`, [null, null]],
    ["valid table", valid, [false, true]],
  ]) {
    await t.test(name, async () => {
      await write(root, proposalPath, proposal);
      // A broken neighbor shares the same repository; its diagnostics remain visible.
      await write(root, "openspec/changes/neighbor/proposal.md", `${header}| web | unknown |\n`);
      const direct = await openSpecGraphAgentContribution.enhance({
        application, operation: "getAssignmentScope", input: { change_id: changeId }, result,
      });
      const embedded = await openSpecGraphAgentContribution.enhance({
        application, operation: "getChangeContext",
        input: { change_id: changeId, include_assignment: true },
        result: { current_repository: result.current_repository, assignment_scope: result },
      });
      assert.deepEqual(direct.assignments.map(({ assigned }) => assigned), expected);
      assert.equal(direct.assigned, expected[1]);
      assert.deepEqual(embedded.assignment_scope.assignments, direct.assignments);
      assert.equal(embedded.assignment_scope.assigned, direct.assigned);
      assert.ok(direct.graph_impact.diagnostics.length);
    });
  }
  await fs.rm(path.join(root, proposalPath));
  for (const selected of [changeId, "empty-change"]) {
    const scope = await openSpecGraphAgentContribution.enhance({
      application, operation: "getAssignmentScope", input: { change_id: selected }, result,
    });
    assert.equal(scope.assigned, null);
    assert.deepEqual(scope.assignments.map(({ assigned }) => assigned), [null, null]);
  }
});

/** Returns all diagnostic codes in deterministic report order. */
function codes(report) {
  return report.diagnostics.map(({ code }) => code);
}

test("Package exposes a Store-only Plugin with graph commands and no sync", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  assert.deepEqual(assertPluginContract({ plugin, packageManifest }), {
    id: "openspec-graph",
    commands: ["inspect", "view"],
  });
  assert.deepEqual(plugin.supports, ["store", "specs"]);
  assert.equal(plugin.canExec(), true);
  assert.equal(plugin.canSync(), false);
  assert.equal(plugin.hasExtensionContribution(), true);
  assert.equal(packageManifest.files.includes("template"), false);
  await assert.rejects(
    fs.access(path.join(packageRoot, "template", "template.yaml")),
    { code: "ENOENT" },
  );
});

test("Empty Store compiles without OpenSpec Graph config or OpenSpec content", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-graph-empty-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await compileOpenSpecGraph(root, { repositories, storeId });

  assert.equal(report.state, "ready");
  assert.deepEqual(report.summary, { nodes: 3, edges: 2, errors: 0, warnings: 0 });
  assert.deepEqual(report.nodes.map(({ id, status }) => [id, status]), [
    ["repository:control", "ok"],
    ["repository:web", "ok"],
    ["store:specs", "ok"],
  ]);
  assert.equal(report.edges.every(({ relation }) => relation === "contains"), true);
});

test("Compiler derives exact Repository and Master Spec links from Repository Impact", async (t) => {
  const root = await storeFixture(t);
  const first = await compileOpenSpecGraph(root, { repositories, storeId });
  const second = await compileOpenSpecGraph(root, { repositories, storeId });

  assert.deepEqual(second, first);
  assert.equal(first.state, "ready");
  assert.deepEqual(first.summary, { nodes: 8, edges: 11, errors: 0, warnings: 1 });
  assert.deepEqual(codes(first), ["UNLINKED_MASTER_SPEC"]);
  assert.deepEqual(
    first.edges.filter(({ relation }) => ["changes_in", "linked"].includes(relation))
      .map(({ source, relation, target, via_changes, provenance, status }) => ({
        source, relation, target, via_changes, provenance, status,
      })),
    [
      {
        source: "change:jit-100-promote",
        relation: "changes_in",
        target: "repository:web",
        via_changes: ["jit-100-promote"],
        provenance: [{
          path: "openspec/changes/jit-100-promote/proposal.md",
          line: 7,
          field: "repository-impact[0].repository",
        }],
        status: "ok",
      },
      {
        source: "repository:web",
        relation: "linked",
        target: "master-spec:conference/visitors",
        via_changes: ["jit-100-promote"],
        provenance: [{
          path: "openspec/changes/jit-100-promote/proposal.md",
          line: 7,
          field: "repository-impact[0].capabilities[0]",
        }],
        status: "ok",
      },
    ],
  );
  assert.equal(
    first.nodes.find(({ id }) => id === "master-spec:conference/agenda").status,
    "warning",
  );
});

test("Plugin config maps localized Delta headings to canonical operations", async (t) => {
  const root = await storeFixture(t);
  await write(root, "openspec-graph.yaml", [
    "version: 1",
    "operation_headings:",
    "  ADDED:",
    "    - '### Добавленные требования'",
    "  MODIFIED:",
    "    - '## Требования изменены'",
    "  REMOVED:",
    "    - '#### Удалённые требования'",
    "  RENAMED:",
    "    - '## Переименованные требования'",
    "",
  ].join("\n"));
  await write(
    root,
    "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md",
    [
      "### Добавленные требования",
      "",
      "### Requirement: Added visitor rule",
      "The system SHALL add it.",
      "",
      "## требования   ИЗМЕНЕНЫ",
      "",
      "### Requirement: Modified visitor rule",
      "The system SHALL modify it.",
      "",
      "#### Удалённые требования",
      "",
      "### Requirement: Removed visitor rule",
      "The system SHALL remove it.",
      "",
      "## Переименованные требования",
      "",
      "FROM: Old visitor rule",
      "TO: New visitor rule",
      "",
    ].join("\n"),
  );

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  const changes = report.edges.filter(({ relation }) => relation === "changes");
  const affects = report.edges.find(({ relation }) => relation === "affects");

  assert.deepEqual(changes.map(({ operation }) => operation), [
    "ADDED",
    "MODIFIED",
    "REMOVED",
    "RENAMED",
  ]);
  assert.deepEqual(affects.operations, ["ADDED", "MODIFIED", "REMOVED", "RENAMED"]);
  assert.equal(codes(report).includes("DELTA_OPERATIONS_MISSING"), false);

  const activePath = path.join(root, "openspec/changes/jit-100-promote");
  const archivePath = path.join(root, "openspec/changes/archive/2026-08-27-jit-100-promote");
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.rename(activePath, archivePath);
  const archivedReport = await compileOpenSpecGraph(root, { repositories, storeId });

  assert.deepEqual(
    archivedReport.edges.filter(({ relation }) => relation === "changes")
      .map(({ operation }) => operation),
    ["ADDED", "MODIFIED", "REMOVED", "RENAMED"],
  );
  assert.equal(
    archivedReport.nodes.find(({ id }) => id === "change:archive/2026-08-27-jit-100-promote").state,
    "archived",
  );
});

test("Active and repeated archived Changes keep separate nodes, deltas and impact", async (t) => {
  const root = await storeFixture(t);
  const name = "jit-100-promote";
  const activePath = path.join(root, "openspec/changes", name);
  const archiveIds = ["2026-08-27", "2026-08-28"].map((date) => `archive/${date}-${name}`);
  for (const id of archiveIds) {
    await fs.cp(activePath, path.join(root, "openspec/changes", id), { recursive: true });
  }
  await write(root, `openspec/changes/${archiveIds[0]}/proposal.md`, [
    "## Repository Impact", "", "| Repository | Capabilities |", "| --- | --- |",
    "| control | conference/visitors |", "",
  ].join("\n"));
  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.equal(new Set(report.nodes.map(({ id }) => id)).size, report.nodes.length);
  for (const [id, repository] of [[name, "web"], [archiveIds[0], "control"], [archiveIds[1], "web"]]) {
    const impact = inspectChangeImpact(report, id);
    assert.equal(impact.change.path, `openspec/changes/${id}`);
    assert.equal(impact.change.state, id === name ? "active" : "archived");
    assert.deepEqual(impact.repositories.map(({ id: nodeId }) => nodeId), [`repository:${repository}`]);
    assert.deepEqual(impact.delta_specs.map(({ id: nodeId }) => nodeId), [
      `delta-spec:${id}/conference/visitors`,
    ]);
    assert.ok(impact.edges.filter(({ relation }) => relation === "linked")
      .every(({ via_changes: changes }) => changes.includes(id)));
  }
  assert.ok(report.nodes.some(({ id }) => id === "master-spec:conference/agenda"));
  await fs.rm(activePath, { recursive: true });
  const archivedOnly = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.throws(() => inspectChangeImpact(archivedOnly, name), /CHANGE_NOT_FOUND/);
  for (const id of archiveIds) assert.equal(inspectChangeImpact(archivedOnly, id).change.state, "archived");
});

test("Empty Delta operation sections do not create Graph edges", async (t) => {
  const root = await storeFixture(t);
  await write(
    root,
    "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md",
    [
      "## ADDED Requirements",
      "",
      "### Requirement: Visitor badge",
      "The system SHALL add it.",
      "",
      "## MODIFIED Requirements",
      "",
      "None.",
      "",
    ].join("\n"),
  );

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.deepEqual(
    report.edges.filter(({ relation }) => relation === "changes")
      .map(({ operation }) => operation),
    ["ADDED"],
  );
});

test("Empty section filtering does not assume operation names or payload syntax", () => {
  const parsed = parseDeltaOperations(
    "## CUSTOM Operation\n\nschema-defined payload\n",
    new Map([["## custom operation", "CUSTOM"]]),
  );

  assert.deepEqual(parsed.operations, [{ operation: "CUSTOM", line: 1 }]);
});

test("Invalid operation heading config falls back atomically to built-ins", async (t) => {
  const scenarios = [
    [
      "version: 1",
      "operation_headings:",
      "  ADDED: ['## Общие требования']",
      "  MODIFIED: ['## Общие требования']",
      "",
    ].join("\n"),
    [
      "version: 2",
      "operation_headings:",
      "  ADDED: ['## Общие требования']",
      "",
    ].join("\n"),
  ];

  for (const config of scenarios) {
    const root = await storeFixture(t);
    await write(root, "openspec-graph.yaml", config);
    await write(
      root,
      "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md",
      "## Общие требования\n",
    );

    const report = await compileOpenSpecGraph(root, { repositories, storeId });

    assert.equal(report.state, "invalid");
    assert.equal(codes(report).includes("OPERATION_HEADINGS_CONFIG_INVALID"), true);
    assert.equal(codes(report).includes("DELTA_OPERATIONS_MISSING"), true);
    assert.equal(report.edges.some(({ relation }) => relation === "changes"), false);
  }
});

test("Archive preserves and aggregates the neutral Repository relation", async (t) => {
  const root = await storeFixture(t);
  const activePath = path.join(root, "openspec/changes/jit-100-promote");
  const archivePath = path.join(root, "openspec/changes/archive/2026-08-27-jit-100-promote");
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.rename(activePath, archivePath);

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  const change = report.nodes.find(({ id }) => id === "change:archive/2026-08-27-jit-100-promote");
  const link = report.edges.find(({ relation }) => relation === "linked");
  assert.equal(change.state, "archived");
  assert.equal(link.source, "repository:web");
  assert.equal(link.target, "master-spec:conference/visitors");
  assert.deepEqual(link.via_changes, ["archive/2026-08-27-jit-100-promote"]);
  assert.deepEqual(link.provenance, [
    {
      path: "openspec/changes/archive/2026-08-27-jit-100-promote/proposal.md",
      line: 7,
      field: "repository-impact[0].capabilities[0]",
    },
  ]);
});

test("Archived Delta reports a missing current Master Spec", async (t) => {
  const root = await storeFixture(t);
  await fs.rm(path.join(root, "openspec/specs/conference/visitors"), { recursive: true });
  const activePath = path.join(root, "openspec/changes/jit-100-promote");
  const archivePath = path.join(root, "openspec/changes/archive/2026-08-27-jit-100-promote");
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.rename(activePath, archivePath);

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  const master = report.nodes.find(({ id }) => id === "master-spec:conference/visitors");
  assert.equal(report.state, "invalid");
  assert.equal(codes(report).includes("ARCHIVED_MASTER_SPEC_MISSING"), true);
  assert.equal(master.state, "missing");
  assert.equal(master.placeholder, true);
  assert.equal(master.status, "error");
});

test("Unknown Repository remains visible as a recoverable error", async (t) => {
  const root = await storeFixture(t);
  const proposal = path.join(root, "openspec/changes/jit-100-promote/proposal.md");
  await fs.writeFile(proposal, (await fs.readFile(proposal, "utf8")).replace("`web`", "`missing`"));

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.equal(report.state, "invalid");
  assert.equal(report.summary.errors, 1);
  assert.equal(codes(report).includes("GRAPH_UNKNOWN_REPOSITORY"), true);
  assert.deepEqual(
    report.nodes.find(({ id }) => id === "repository:missing"),
    {
      id: "repository:missing",
      type: "repository",
      label: "missing",
      repository_id: "missing",
      state: "missing",
      placeholder: true,
      status: "error",
    },
  );
  assert.equal(
    report.edges.find(({ relation }) => relation === "linked").status,
    "error",
  );
});

test("Repository Impact cannot create a cross-product with undeclared capabilities", async (t) => {
  const root = await storeFixture(t);
  const proposal = path.join(root, "openspec/changes/jit-100-promote/proposal.md");
  await fs.writeFile(proposal, (await fs.readFile(proposal, "utf8")).replace(
    "`conference/visitors`",
    "`conference/visitors`, `conference/agenda`",
  ));

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.equal(report.state, "invalid");
  assert.equal(codes(report).includes("REPOSITORY_IMPACT_UNKNOWN_CAPABILITY"), true);
  assert.equal(
    report.edges.some(({ relation, target }) => (
      relation === "linked" && target === "master-spec:conference/agenda"
    )),
    false,
  );
});

test("Change impact contains only linked relations declared by that Change", async (t) => {
  const root = await storeFixture(t);
  await write(
    root,
    "openspec/changes/jit-100-promote/specs/conference/agenda/spec.md",
    "## MODIFIED Requirements\n\n### Requirement: Agenda\nThe system SHALL update it.\n",
  );
  await write(root, "openspec/changes/jit-100-promote/proposal.md", [
    "# Promote visitors",
    "",
    "## Repository Impact",
    "",
    "| Repository | Capabilities |",
    "| --- | --- |",
    "| `web` | `conference/visitors` |",
    "| `control` | `conference/agenda` |",
    "",
  ].join("\n"));
  await write(
    root,
    "openspec/changes/jit-200-agenda/specs/conference/agenda/spec.md",
    "## MODIFIED Requirements\n\n### Requirement: Agenda\nThe system SHALL refine it.\n",
  );
  await write(root, "openspec/changes/jit-200-agenda/proposal.md", [
    "# Refine agenda",
    "",
    "## Repository Impact",
    "",
    "| Repository | Capabilities |",
    "| --- | --- |",
    "| `web` | `conference/agenda` |",
    "",
  ].join("\n"));

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  const impact = inspectChangeImpact(report, "jit-100-promote");
  const linked = impact.edges.filter(({ relation }) => relation === "linked");
  assert.deepEqual(linked.map(({ source, target }) => [source, target]), [
    ["repository:control", "master-spec:conference/agenda"],
    ["repository:web", "master-spec:conference/visitors"],
  ]);
  assert.equal(linked.every(({ via_changes: changes }) => changes.includes("jit-100-promote")), true);
});

test("Every graph edge exposes structured machine-readable provenance", async (t) => {
  const root = await storeFixture(t);
  const report = await compileOpenSpecGraph(root, { repositories, storeId });

  for (const value of report.edges) {
    assert.equal(value.provenance.length > 0, true, value.id);
    for (const source of value.provenance) {
      assert.equal(typeof source.path, "string", value.id);
      assert.equal(Number.isInteger(source.line), true, value.id);
      assert.equal(typeof source.field, "string", value.id);
    }
  }
  assert.deepEqual(
    report.edges.find(({ relation, target }) => (
      relation === "contains" && target === "repository:web"
    )).provenance,
    [{ path: "openspec-orch.yaml", line: 5, field: "repositories[1].id" }],
  );
});

test("Duplicate Delta operations are reported and projected only once", async (t) => {
  const root = await storeFixture(t);
  const delta = path.join(
    root,
    "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md",
  );
  await fs.appendFile(delta, [
    "",
    "## MODIFIED Requirements",
    "",
    "### Requirement: Duplicate section",
    "The system SHALL reject it.",
    "",
  ].join("\n"));

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.equal(report.state, "invalid");
  assert.equal(codes(report).includes("DELTA_OPERATION_DUPLICATE"), true);
  assert.equal(report.edges.filter(({ relation }) => relation === "changes").length, 1);
});

test("Repository Impact and Change metadata diagnostics cover malformed declarations", async (t) => {
  const scenarios = [
    {
      code: "REPOSITORY_IMPACT_DUPLICATE_SECTION",
      mutate: async (root) => fs.appendFile(
        path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
        "\n## Repository Impact\n",
      ),
    },
    {
      code: "REPOSITORY_IMPACT_DUPLICATE_MAPPING",
      mutate: async (root) => fs.appendFile(
        path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
        "| `web` | `conference/visitors` |\n",
      ),
    },
    {
      code: "REPOSITORY_IMPACT_ROW_INVALID",
      mutate: async (root) => fs.appendFile(
        path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
        "| `web` | |\n",
      ),
    },
    {
      code: "REPOSITORY_IMPACT_EMPTY",
      mutate: async (root) => fs.writeFile(
        path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
        [
          "## Repository Impact",
          "",
          "| Repository | Capabilities |",
          "| --- | --- |",
          "",
        ].join("\n"),
      ),
    },
    {
      code: "CHANGE_METADATA_INVALID",
      mutate: async (root) => fs.writeFile(
        path.join(root, "openspec/changes/empty-change/.openspec.yaml"),
        "skip_specs: [\n",
      ),
    },
    {
      code: "REPOSITORY_IMPACT_MISSING",
      mutate: async (root) => fs.rm(
        path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
      ),
    },
  ];

  for (const scenario of scenarios) {
    const root = await storeFixture(t);
    await scenario.mutate(root);
    const report = await compileOpenSpecGraph(root, { repositories, storeId });
    assert.equal(codes(report).includes(scenario.code), true, scenario.code);
  }
});

test("Malformed Repository Impact and Delta operations are report diagnostics", async (t) => {
  const root = await storeFixture(t);
  await fs.writeFile(
    path.join(root, "openspec/changes/jit-100-promote/proposal.md"),
    "## Repository Impact\n\n- web\n",
  );
  await fs.writeFile(
    path.join(root, "openspec/changes/jit-100-promote/specs/conference/visitors/spec.md"),
    "## Requirements\n",
  );

  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  assert.equal(report.state, "invalid");
  assert.equal(codes(report).includes("REPOSITORY_IMPACT_TABLE_INVALID"), true);
  assert.equal(codes(report).includes("DELTA_OPERATIONS_MISSING"), true);
  assert.equal(report.nodes.length > 0, true);
  assert.equal(report.edges.length > 0, true);
});

test("Structural Change impact query uses affects, changes_in and linked edges only", async (t) => {
  const root = await storeFixture(t);
  const report = await compileOpenSpecGraph(root, { repositories, storeId });
  const impact = inspectChangeImpact(report, "jit-100-promote");
  const view = inspectGraphNode(report, "master-spec:conference/visitors");

  assert.deepEqual(impact.master_specs.map(({ id }) => id), [
    "master-spec:conference/visitors",
  ]);
  assert.deepEqual(impact.repositories.map(({ id }) => id), ["repository:web"]);
  assert.equal(impact.edges.some(({ relation }) => relation === "linked"), true);
  assert.deepEqual(view.neighbors.map(({ id }) => id), [
    "change:jit-100-promote",
    "delta-spec:jit-100-promote/conference/visitors",
    "repository:web",
    "store:specs",
  ]);
});

test("Plugin owns its Agent tool, context overlay and unavailable fallback", async () => {
  const contribution = plugin.agentContribution();
  const [tool] = contribution.tools;
  const calls = [];
  const application = Object.freeze({
    query(query, id) {
      calls.push([query, id]);
      return Promise.resolve({ repositories: [{ id: "repository:web" }] });
    },
  });

  assert.equal(contribution.requireBinding, true);
  assert.deepEqual(contribution.tools.map(({ name }) => name), [
    "get_spec_graph", "get_spec_graph_node", "get_spec_change_impact",
  ]);
  for (const candidate of contribution.tools) {
    for (const keyword of ["oneOf", "anyOf", "allOf"]) {
      assert.equal(Object.hasOwn(candidate.definition.inputSchema, keyword), false);
    }
    assert.equal(candidate.repositoryParameter, "store_repository_id");
    for (const value of [null, "", " ", 12]) {
      assert.throws(() => candidate.validate({ store_repository_id: value }), /store_repository_id/);
    }
  }
  for (const [index, field] of [[1, "node_id"], [2, "change_id"]]) {
    const candidate = contribution.tools[index];
    assert.deepEqual(candidate.definition.inputSchema.required, [field]);
    for (const value of [undefined, null, "", " ", 12]) {
      assert.throws(() => candidate.validate({ [field]: value }), new RegExp(field));
    }
    assert.doesNotThrow(() => candidate.validate({ [field]: "example" }));
  }
  assert.deepEqual(tool.definition.inputSchema.required, []);
  assert.doesNotThrow(() => tool.validate({}));
  assert.deepEqual(await tool.execute(application, {}), {
    repositories: [{ id: "repository:web" }],
  });
  assert.throws(() => tool.execute(null, {}), /CAPABILITY_UNAVAILABLE/u);

  const status = await contribution.enhance({
    operation: "getStatus",
    input: {},
    result: Object.freeze({ capabilities: Object.freeze({}) }),
    application: null,
  });
  assert.deepEqual(status.capabilities.graph, {
    provider: "openspec-graph",
    available: false,
    reason: "Plugin is not connected or unavailable; inspect Doctor",
  });

  const assignment = await contribution.enhance({
    operation: "getAssignmentScope",
    input: { change_id: "pay" },
    result: Object.freeze({
      current_repository: Object.freeze({ repository_id: "web", role: "code" }),
      assignments: Object.freeze([
        Object.freeze({ repository_id: "web", assigned: null }),
        Object.freeze({ repository_id: "worker", assigned: null }),
      ]),
    }),
    application,
  });
  assert.equal(assignment.assigned, true);
  assert.deepEqual(assignment.assignments.map(({ repository_id: id, assigned }) => (
    [id, assigned]
  )), [["web", true], ["worker", false]]);
  assert.deepEqual(calls, [
    ["report", undefined],
    ["change_impact", "pay"],
  ]);
});

test("Plugin lifecycle is stateless and inspect compiles without storage", async (t) => {
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  const report = {
    report_version: 1,
    graph_version: 1,
    state: "ready",
    nodes: [{ id: "store:specs", status: "ok" }],
    edges: [],
    diagnostics: [],
    summary: { nodes: 1, edges: 0, errors: 0, warnings: 0 },
  };
  const calls = [];
  const context = Object.freeze({
    repository: Object.freeze({ id: "specs", role: "store" }),
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
        return Promise.resolve(executable === process.execPath ? JSON.stringify(report) : "{}");
      },
    }),
    storage: Object.freeze({
      read() { throw new Error("storage must not be read"); },
      write() { throw new Error("storage must not be written"); },
    }),
  });

  assert.equal(
    await plugin.connect(context),
    "OpenSpec Graph подключён; граф компилируется командами inspect и view",
  );
  assert.deepEqual(await plugin.status(context), {
    state: "ready",
    details: JSON.stringify({
      mode: "compile_on_demand",
      command: "openspec-orch plugin exec openspec-graph inspect",
    }),
  });
  await plugin.exec(context, ["inspect", "--json"]);
  assert.deepEqual(JSON.parse(output.at(-1)), report);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1].slice(1, 5), ["compile", ".", "--store-id", "specs"]);
  assert.equal(calls[1][0], "openspec");
  await assert.rejects(plugin.exec(context, ["build"]));
  assert.throws(() => plugin.sync(context), /PLUGIN_SYNC_UNSUPPORTED/u);
});

test("Strict OpenSpec validation failure is folded into an invalid report", async (t) => {
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  const report = {
    report_version: 1,
    graph_version: 1,
    state: "ready",
    nodes: [{ id: "store:specs", status: "ok" }],
    edges: [],
    diagnostics: [],
    summary: { nodes: 1, edges: 0, errors: 0, warnings: 0 },
  };
  const context = Object.freeze({
    repository: Object.freeze({ id: "specs", role: "store" }),
    project: Object.freeze({ id: "specs", repositories: Object.freeze([]) }),
    process: Object.freeze({
      run(executable) {
        if (executable === process.execPath) return Promise.resolve(JSON.stringify(report));
        return Promise.reject(new Error("strict validation failed"));
      },
    }),
  });

  await assert.rejects(
    plugin.exec(context, ["inspect", "--json"]),
    /OPENSPEC_GRAPH_INSPECTION_FAILED/u,
  );
  const inspected = JSON.parse(output.at(-1));
  assert.equal(inspected.state, "invalid");
  assert.equal(inspected.summary.errors, 1);
  assert.equal(inspected.diagnostics[0].code, "OPENSPEC_VALIDATION_FAILED");
});

test("graph view serves a recoverable invalid report and prints only its summary", async () => {
  const output = [];
  const baseReport = {
    report_version: 1,
    graph_version: 1,
    state: "ready",
    nodes: [{ id: "store:specs", status: "ok" }],
    edges: [],
    diagnostics: [],
    summary: { nodes: 1, edges: 0, errors: 0, warnings: 0 },
  };
  const context = Object.freeze({
    invocation: Object.freeze({ role: "store", path: "/tmp/specs" }),
    project: Object.freeze({ id: "specs", repositories: Object.freeze([]) }),
    process: Object.freeze({
      run(executable) {
        if (executable === process.execPath) return Promise.resolve(JSON.stringify(baseReport));
        return Promise.reject(new Error("strict validation failed"));
      },
    }),
    files: Object.freeze({ read: () => Promise.resolve("") }),
  });
  let served;
  const report = await runGraphView(context, { port: 0 }, {
    output: { log: (value) => output.push(value) },
    progress: { run: (_message, operation) => operation() },
    startViewer: (candidate, options) => {
      served = { candidate, options };
      return Promise.resolve({
        url: "http://127.0.0.1:12345",
        wait: () => Promise.resolve(),
      });
    },
  });

  assert.equal(report.state, "invalid");
  assert.equal(served.candidate, report);
  assert.equal(served.options.port, 0);
  assert.deepEqual(output.slice(0, 5), [
    "OpenSpec Graph",
    "  nodes: 1",
    "  edges: 0",
    "  errors: 1",
    "  warnings: 0",
  ]);
  assert.equal(output.some((value) => String(value).includes("OPENSPEC_VALIDATION_FAILED")), false);
});

test("viewer serves graph diagnostics and structured evidence from loopback", async (t) => {
  const report = {
    report_version: 1,
    graph_version: 1,
    state: "invalid",
    nodes: [{ id: "store:specs", type: "store", status: "ok" }],
    edges: [{
      id: "derived:test",
      source: "store:specs",
      relation: "contains",
      target: "repository:web",
      provenance: [{ path: "openspec-orch.yaml", line: 2, field: "repositories.web" }],
      status: "ok",
    }],
    diagnostics: [{
      id: "diagnostic:1",
      code: "OPENSPEC_VALIDATION_FAILED",
      severity: "error",
      message: "strict validation failed",
      elements: [],
    }],
    summary: { nodes: 1, edges: 1, errors: 1, warnings: 0 },
  };
  let handleRequest;
  const fakeServer = {
    once() {},
    listen(_port, _host, resolve) { resolve(); },
    address() { return { port: 12345 }; },
    close(resolve) { resolve(); },
  };
  const viewer = await startGraphViewer(report, {
    port: 0,
    readSource: (relativePath) => Promise.resolve(`source:${relativePath}`),
    createServer(handler) {
      handleRequest = handler;
      return fakeServer;
    },
  });
  t.after(() => viewer.close());

  /** Executes one viewer route without binding a network socket. */
  async function request(pathname) {
    let status;
    let body = "";
    await handleRequest(
      { method: "GET", url: pathname },
      {
        writeHead(value) { status = value; },
        end(value = "") { body += value; },
      },
    );
    assert.equal(status, 200);
    return body;
  }

  const [html, app, reportSource, configSource] = await Promise.all([
    request("/"),
    request("/app.js"),
    request("/graph.json"),
    request("/viewer-config.json"),
  ]);
  const servedReport = JSON.parse(reportSource);
  const config = JSON.parse(configSource);
  assert.match(html, /id="graph-diagnostics"/u);
  assert.match(app, /renderGraphDiagnostics\(\)/u);
  assert.deepEqual(servedReport, report);
  const evidence = Object.values(config.evidence);
  assert.equal(evidence.length, 1);
  const preview = await request(evidence[0].preview_url);
  assert.equal(preview, "source:openspec-orch.yaml");
});


test("Graph rejects a symlinked openspec ancestor before reading outside Store", async (t) => {
  const root = await storeFixture(t);
  const outside = path.join(root, "external-specs");
  await fs.rename(path.join(root, "openspec"), outside);
  await fs.symlink(outside, path.join(root, "openspec"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(compileOpenSpecGraph(root, { storeId, repositories }), /symlink|ordinary directory/);
});

test("viewer navigates linked Stores with isolated sources and recoverable failures", async (t) => {
  const graph = { nodes: [{ id: "master-spec:shared", type: "master-spec", path: "openspec/specs/shared/spec.md" }], edges: [], diagnostics: [], summary: { errors: 0, warnings: 0 } };
  let handler;
  let broken = true;
  let failOnce = false;
  let source = "parent";
  const calls = [];
  const viewer = await startGraphViewer(graph, {
    readSource: async () => source,
    linkedStores: [{ id: "payments" }, { id: "platform" }, { id: "offline" }],
    async loadRepository(id) {
      calls.push(id);
      if ((broken || failOnce) && id === "offline") {
        failOnce = false;
        throw new Error("Store <unavailable>");
      }
      return { graph: { ...graph, source: { repository_id: id } }, readSource: async () => id };
    },
    createServer(callback) {
      handler = callback;
      return { once() {}, listen(_port, _host, resolve) { resolve(); },
        address() { return { port: 12345 }; }, close(resolve) { resolve(); } };
    },
  });
  t.after(() => viewer.close());
  /** Executes a scoped viewer request without a socket. */
  async function request(url) {
    let status;
    let body;
    await handler({ method: "GET", url }, { writeHead(value) { status = value; }, end(value) { body = value; } });
    return { status, body };
  }
  const parent = JSON.parse((await request("/viewer-config.json")).body);
  assert.equal(parent.navigation.length, 3);
  assert.deepEqual(calls, []);
  const selected = JSON.parse((await request("/graph.json?repository=payments")).body);
  assert.equal(selected.source.repository_id, "payments");
  const config = JSON.parse((await request("/viewer-config.json?repository=payments")).body);
  assert.equal(config.navigation[0].href, "/");
  assert.equal((await request(config.sources["master-spec:shared"].preview_url)).body, "payments");
  assert.equal((await request(parent.sources["master-spec:shared"].preview_url)).body, "parent");
  assert.equal((await request("/source/unknown?repository=payments")).status, 404);
  const before = calls.length;
  assert.equal((await request("/graph.json?repository=unknown")).status, 404);
  assert.equal(calls.length, before);
  const expandedUrl = "/graph.json?expand=payments&expand=platform";
  const combined = JSON.parse((await request(expandedUrl)).body);
  assert.equal(combined.nodes.length, 3);
  assert.equal(new Set(combined.nodes.map(({ id }) => id)).size, 3);
  const combinedConfig = JSON.parse((await request("/viewer-config.json?expand=payments&expand=platform")).body);
  assert.equal((await request(combinedConfig.sources["master-spec:payments::shared"].preview_url)).body, "payments");
  assert.equal((await request(combinedConfig.sources["master-spec:platform::shared"].preview_url)).body, "platform");
  assert.equal((await request("/source/master-spec%3Apayments%3A%3Ashared")).status, 404);
  assert.equal((await request("/graph.json?expand=unknown")).status, 404);
  assert.deepEqual(calls, ["payments", "platform"]);
  source = "edited after snapshot";
  assert.equal((await request(parent.sources["master-spec:shared"].preview_url)).body, "parent");
  const failed = await request("/?repository=offline");
  assert.equal(failed.status, 500);
  assert.match(failed.body, /Store &lt;unavailable&gt;/);
  assert.match(failed.body, /href="\/"/);
  const partial = JSON.parse((await request("/graph.json?expand=payments&expand=offline")).body);
  assert.equal(partial.nodes.some(({ team_id }) => team_id === "payments"), true);
  const partialConfig = JSON.parse((await request("/viewer-config.json?expand=offline")).body);
  assert.match(partialConfig.navigation.find(({ id }) => id === "offline").error, /unavailable/);
  broken = false;
  failOnce = true;
  const failedState = JSON.parse((await request("/viewer-state.json?expand=offline")).body);
  assert.equal(failedState.graph.nodes.some(({ team_id }) => team_id === "offline"), false);
  assert.match(failedState.config.navigation.find(({ id }) => id === "offline").error, /unavailable/);
  const failedCalls = calls.filter((id) => id === "offline").length;
  const recoveredState = JSON.parse((await request("/viewer-state.json?expand=offline")).body);
  assert.equal(recoveredState.graph.nodes.some(({ team_id }) => team_id === "offline"), true);
  assert.equal(recoveredState.config.navigation.find(({ id }) => id === "offline").error, undefined);
  assert.equal(calls.filter((id) => id === "offline").length, failedCalls + 1);
  assert.equal((await request("/graph.json?repository=offline")).status, 200);
});

test("node and impact queries retain report validation diagnostics", async () => {
  const { OpenSpecGraphApplication } = await import("../lib/application.js");
  const report = { state: "invalid", summary: { errors: 1 },
    diagnostics: [{ code: "OPENSPEC_VALIDATION_FAILED", severity: "error" }],
    nodes: [{ id: "change:pay", type: "change", change_id: "pay" }], edges: [] };
  const app = new OpenSpecGraphApplication({}, { service: { async compile() { return report; } } });
  for (const [query, id] of [["node", "change:pay"], ["change_impact", "pay"]]) {
    const result = await app.query(query, id);
    assert.equal(result.state, "invalid");
    assert.deepEqual(result.diagnostics, report.diagnostics);
    assert.deepEqual(result.summary, report.summary);
  }
});
