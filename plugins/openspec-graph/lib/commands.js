/** @fileoverview Human-facing stateless OpenSpec Graph commands. */

import {
  COMMAND_SCOPE,
  createCliProgress,
  REPOSITORY_ROLE,
} from "@openspec-orch/plugin-sdk";

import { OpenSpecGraphApplication } from "./application.js";
import { OPEN_SPEC_GRAPH_CONFIG } from "./config.js";
import { startGraphViewer } from "./viewer.js";

/** Parses a loopback HTTP port. */
function port(value) {
  const parsed = Number(value);
  const { minimumPort, maximumPort } = OPEN_SPEC_GRAPH_CONFIG.viewer;
  if (!Number.isInteger(parsed) || parsed < minimumPort || parsed > maximumPort) {
    throw new Error(`port must be an integer between ${minimumPort} and ${maximumPort}`);
  }
  return parsed;
}

/** Formats one machine-readable diagnostic source for a person. */
function sourceLabel(source) {
  if (!source) return "";
  return ` (${source.path}:${source.line}${source.field ? `, ${source.field}` : ""})`;
}

/** Prints all diagnostics first encountered on one element. */
function printElementDiagnostics(report, elementId, shown, write) {
  for (const value of report.diagnostics) {
    if (shown.has(value.id) || !value.elements.includes(elementId)) continue;
    shown.add(value.id);
    write(`    ${value.code}: ${value.message}${sourceLabel(value.source)}`);
  }
}

/** Prints the detailed inspection contract with one row per node and edge. */
function printInspection(report, write) {
  const shown = new Set();
  write("OpenSpec Graph inspection");
  write("");
  write("Nodes");
  for (const value of report.nodes) {
    write(`${OPEN_SPEC_GRAPH_CONFIG.markers[value.status]} ${value.id}`);
    printElementDiagnostics(report, value.id, shown, write);
  }
  write("");
  write("Edges");
  for (const value of report.edges) {
    write(
      `${OPEN_SPEC_GRAPH_CONFIG.markers[value.status]} ` +
        `${value.source} → ${value.relation} → ${value.target}`,
    );
    printElementDiagnostics(report, value.id, shown, write);
  }
  const graphDiagnostics = report.diagnostics.filter(({ id }) => !shown.has(id));
  if (graphDiagnostics.length > 0) {
    write("");
    write("Graph");
    for (const value of graphDiagnostics) {
      write(
        `${OPEN_SPEC_GRAPH_CONFIG.markers[value.severity]} ` +
          `${value.code}: ${value.message}${sourceLabel(value.source)}`,
      );
    }
  }
  write("");
  printSummary(report, write);
}

/** Prints the common four-counter summary. */
function printSummary(report, write) {
  write("Summary");
  write(`  nodes: ${report.summary.nodes}`);
  write(`  edges: ${report.summary.edges}`);
  write(`  errors: ${report.summary.errors}`);
  write(`  warnings: ${report.summary.warnings}`);
}

/** Converts an invalid report into a non-zero command result after printing it. */
function assertSuccessful(report) {
  if (report.summary.errors === 0) return;
  throw Object.assign(
    new Error(`OPENSPEC_GRAPH_INSPECTION_FAILED: ${report.summary.errors} error(s)`),
    { code: "OPENSPEC_GRAPH_INSPECTION_FAILED" },
  );
}

/** Compiles and serves one current report, including recoverable diagnostics. */
export async function runGraphView(
  context,
  options = {},
  {
    output = console,
    progress = createCliProgress(),
    startViewer = startGraphViewer,
  } = {},
) {
  const report = await progress.run(
    "Компиляция OpenSpec Graph и запуск viewer...",
    () => new OpenSpecGraphApplication(context).compile(),
    { success: "OpenSpec Graph скомпилирован" },
  );
  const sourceRoot = context.invocation?.role === REPOSITORY_ROLE.store
    ? context.invocation.path
    : undefined;
  const viewer = await startViewer(report, {
    port: options.port ?? OPEN_SPEC_GRAPH_CONFIG.viewer.defaultPort,
    readSource: (relativePath) => context.files.read(relativePath),
    sourceRoot,
  });
  output.log("OpenSpec Graph");
  output.log(`  nodes: ${report.summary.nodes}`);
  output.log(`  edges: ${report.summary.edges}`);
  output.log(`  errors: ${report.summary.errors}`);
  output.log(`  warnings: ${report.summary.warnings}`);
  output.log("");
  output.log(`Viewer: ${viewer.url}`);
  output.log("Press Ctrl+C to stop.");
  await viewer.wait();
  return report;
}

/** Registers the two Store-scoped graph commands without exposing Commander. */
export function registerGraphCommands(
  commands,
  { output = console, progress = createCliProgress() } = {},
) {
  commands.command("inspect")
    .description("compile and validate the complete current Store graph")
    .option("--json", "print the full machine-readable report")
    .actionWithContext(async (context, options) => {
      const report = await progress.run(
        "Компиляция и проверка OpenSpec Graph...",
        () => new OpenSpecGraphApplication(context).compile(),
        { success: "OpenSpec Graph проверен" },
      );
      if (options.json) output.log(JSON.stringify(report, null, 2));
      else printInspection(report, (message) => output.log(message));
      assertSuccessful(report);
    }, { scope: COMMAND_SCOPE.store });

  commands.command("view")
    .description("compile the current Store and serve the local read-only graph UI")
    .option("--port <port>", "loopback port; 0 selects a free port", { parser: port })
    .actionWithContext((context, options) => runGraphView(
      context,
      options,
      { output, progress },
    ), { scope: COMMAND_SCOPE.store });
}
