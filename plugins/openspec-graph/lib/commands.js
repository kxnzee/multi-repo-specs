/** @fileoverview Human-facing OpenSpec Graph commands. */

import { OpenSpecGraphService } from "./service.js";
import { checkChangeScope, inspectChangeImpact, inspectGraphNode } from "./query.js";
import { startGraphViewer } from "./viewer.js";

/** Collects a repeatable repository option. */
function collectValues(value, previous = []) {
  return [...previous, value];
}

/** Parses a loopback HTTP port. */
function port(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error("port must be an integer between 0 and 65535");
  }
  return parsed;
}

/** Registers the Store-scoped graph CLI without exposing Commander. */
export function registerGraphCommands(commands, { output = console } = {}) {
  const graph = commands.command("graph")
    .description("build and inspect the OpenSpec repository/spec graph");

  graph.command("build")
    .description("validate OpenSpec and rebuild the graph")
    .actionWithContext(async (context) => {
      const built = await new OpenSpecGraphService(context).build();
      output.log(OpenSpecGraphService.summary(built));
    }, { scope: "store" });

  graph.command("status")
    .description("show graph freshness")
    .option("--json", "print machine-readable status")
    .actionWithContext(async (context, options) => {
      const status = await new OpenSpecGraphService(context).status();
      if (options.json) output.log(JSON.stringify(status, null, 2));
      else output.log(`${status.state}: ${status.details}`);
    }, { scope: "store" });

  graph.command("view")
    .description("serve the local read-only graph UI")
    .option("--port <port>", "loopback port; 0 selects a free port", { parser: port })
    .actionWithContext(async (context, options) => {
      const document = await new OpenSpecGraphService(context).readFresh();
      const sourceRoot = context.invocation?.role === "store"
        ? context.invocation.path
        : undefined;
      const viewer = await startGraphViewer(document, {
        port: options.port ?? 4177,
        readSource: (relativePath) => context.files.read(relativePath),
        sourceRoot,
      });
      output.log(`OpenSpec Graph: ${viewer.url}`);
      output.log("Press Ctrl+C to stop.");
      await viewer.wait();
    }, { scope: "store" });

  graph.command("inspect <node-id>")
    .description("show one node and its direct evidenced neighborhood as JSON")
    .actionWithContext(async (context, nodeId) => {
      const document = await new OpenSpecGraphService(context).readFresh();
      output.log(JSON.stringify(inspectGraphNode(document, nodeId), null, 2));
    }, { scope: "store" });

  graph.command("impact <change-id>")
    .description("show direct capability and repository impact for one Change as JSON")
    .actionWithContext(async (context, changeId) => {
      const document = await new OpenSpecGraphService(context).readFresh();
      output.log(JSON.stringify(inspectChangeImpact(document, changeId), null, 2));
    }, { scope: "store" });

  graph.command("check-scope <change-id>")
    .description("check proposed Cycle repositories against one Change impact")
    .option("--repo <repository-id>", "proposed Cycle repository-id", {
      parser: collectValues,
      required: true,
    })
    .actionWithContext(async (context, changeId, options) => {
      const document = await new OpenSpecGraphService(context).readFresh();
      const result = checkChangeScope(document, changeId, options.repo);
      output.log(JSON.stringify(result, null, 2));
      if (result.state === "invalid") {
        throw new Error("OPENSPEC_GRAPH_SCOPE_INVALID: proposed Cycle scope is incomplete");
      }
    }, { scope: "store" });
}
