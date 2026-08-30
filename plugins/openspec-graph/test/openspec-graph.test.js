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
import { compileOpenSpecGraph } from "../lib/builder.js";
import { runGraphView } from "../lib/commands.js";
import { inspectChangeImpact, inspectGraphNode } from "../lib/query.js";
import { startGraphViewer } from "../lib/viewer.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repositories = [
  { id: "control", role: "code" },
  { id: "web", role: "code" },
];
const storeId = "specs";

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
    commands: ["graph"],
  });
  assert.deepEqual(plugin.supports, ["store"]);
  assert.equal(plugin.canExec(), true);
  assert.equal(plugin.canSync(), false);
  assert.equal(plugin.hasExtensionContribution(), true);
  const repository = Object.freeze({ id: "specs", role: "store" });
  assert.deepEqual(plugin.extensions(Object.freeze({ repository })).map((extension) => ({
    id: extension.id,
    root: extension.root,
    target: extension.target,
  })), [{
    id: "agent",
    root: "./extension",
    target: repository,
  }]);
});

test("Package ships its Store-scoped Agent Extension for every Agent", async () => {
  const extensionRoot = path.join(packageRoot, "extension");
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  const [qwen, gigacode, claude, marketplace, instructions] = await Promise.all([
    fs.readFile(path.join(extensionRoot, "qwen-extension.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, "gigacode-extension.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, ".claude-plugin", "plugin.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, ".claude-plugin", "marketplace.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(extensionRoot, "agent-instructions.md"), "utf8"),
  ]);

  assert.equal(qwen.name, "openspec-graph-agent");
  assert.equal(qwen.contextFileName, "agent-instructions.md");
  assert.equal(gigacode.name, "openspec-graph-agent");
  assert.equal(gigacode.contextFileName, "agent-instructions.md");
  assert.equal(claude.name, "openspec-graph-agent");
  assert.equal(marketplace.name, "openspec-orch-openspec-graph-agent");
  assert.match(instructions, /openspec-orch graph inspect --json/);
  assert.match(instructions, /используй текущий Graph Report как\s+навигационную карту Store/);
  assert.match(instructions, /Он не создаёт новый\s+scope/);
  assert.match(instructions, /\{ path, line, field \}.*provenance/);
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
      "## требования   ИЗМЕНЕНЫ",
      "",
      "#### Удалённые требования",
      "",
      "## Переименованные требования",
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
    archivedReport.nodes.find(({ id }) => id === "change:jit-100-promote").state,
    "archived",
  );
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
  const change = report.nodes.find(({ id }) => id === "change:jit-100-promote");
  const link = report.edges.find(({ relation }) => relation === "linked");
  assert.equal(change.state, "archived");
  assert.equal(link.source, "repository:web");
  assert.equal(link.target, "master-spec:conference/visitors");
  assert.deepEqual(link.via_changes, ["jit-100-promote"]);
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
    "OpenSpec Graph подключён; граф компилируется командами graph inspect и graph view",
  );
  assert.deepEqual(await plugin.status(context), {
    state: "ready",
    details: JSON.stringify({ mode: "compile_on_demand", command: "openspec-orch graph inspect" }),
  });
  await plugin.exec(context, ["graph", "inspect", "--json"]);
  assert.deepEqual(JSON.parse(output.at(-1)), report);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1].slice(1, 5), ["compile", ".", "--store-id", "specs"]);
  assert.equal(calls[1][0], "openspec");
  await assert.rejects(plugin.exec(context, ["graph", "build"]));
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
    plugin.exec(context, ["graph", "inspect", "--json"]),
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
