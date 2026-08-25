/** @fileoverview Human-facing OpenSpec Graph commands. */

import { createCliProgress } from "@openspec-orch/plugin-sdk";

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

/** Prints graph freshness for a person while JSON remains available for automation. */
function printGraphStatus(status, write) {
  const presentation = {
    invalid: ["✗", "текущие данные некорректны"],
    ready: ["✓", "готов и актуален"],
    stale: ["⚠", "требует обновления"],
    unavailable: ["✗", "ещё не построен"],
  }[status.state] ?? ["•", status.state];
  write(`${presentation[0]} OpenSpec Graph — ${presentation[1]}`);
  write(`  Узлы: ${status.nodes}  Рёбра: ${status.edges}`);
  if (status.current_digest) write(`  Текущий digest: ${status.current_digest.slice(0, 12)}`);
  if (status.stored_digest) write(`  Сохранённый digest: ${status.stored_digest.slice(0, 12)}`);
  if (status.last_known_good_available && !status.authoritative) {
    write("  ⚠ Доступен последний успешно построенный граф, но он не считается актуальным");
  }
  if (status.reason) write(`  Причина: ${status.reason}`);
  if (status.next_command) write(`  → Далее: ${status.next_command}`);
}

/** Registers the Store-scoped graph CLI without exposing Commander. */
export function registerGraphCommands(
  commands,
  { output = console, progress = createCliProgress() } = {},
) {
  const graph = commands.command("graph")
    .description("build and inspect the OpenSpec repository/spec graph");

  graph.command("build")
    .description("validate OpenSpec and rebuild the graph")
    .actionWithContext(async (context) => {
      const built = await progress.run(
        "Проверка OpenSpec и построение Graph...",
        () => new OpenSpecGraphService(context).build(),
        { success: "OpenSpec Graph построен" },
      );
      output.log(OpenSpecGraphService.summary(built));
    }, { scope: "store" });

  graph.command("status")
    .description("show graph freshness")
    .option("--json", "print machine-readable status")
    .actionWithContext(async (context, options) => {
      const status = await progress.run(
        "Проверка актуальности OpenSpec Graph...",
        () => new OpenSpecGraphService(context).status(),
        { success: "Актуальность OpenSpec Graph проверена" },
      );
      if (options.json) output.log(JSON.stringify(status, null, 2));
      else printGraphStatus(status, (message) => output.log(message));
    }, { scope: "store" });

  graph.command("view")
    .description("serve the local read-only graph UI")
    .option("--port <port>", "loopback port; 0 selects a free port", { parser: port })
    .actionWithContext(async (context, options) => {
      const viewer = await progress.run("Запуск OpenSpec Graph viewer...", async () => {
        const document = await new OpenSpecGraphService(context).readFresh();
        const sourceRoot = context.invocation?.role === "store"
          ? context.invocation.path
          : undefined;
        return startGraphViewer(document, {
          port: options.port ?? 4177,
          readSource: (relativePath) => context.files.read(relativePath),
          sourceRoot,
        });
      }, { success: "OpenSpec Graph viewer запущен" });
      output.log(`OpenSpec Graph: ${viewer.url}`);
      output.log("Press Ctrl+C to stop.");
      await viewer.wait();
    }, { scope: "store" });

  graph.command("inspect <node-id>")
    .description("show one node and its direct evidenced neighborhood as JSON")
    .actionWithContext(async (context, nodeId) => {
      const document = await progress.run(
        "Проверка графа перед inspect...",
        () => new OpenSpecGraphService(context).readFresh(),
        { success: "OpenSpec Graph актуален" },
      );
      output.log(JSON.stringify(inspectGraphNode(document, nodeId), null, 2));
    }, { scope: "store" });

  graph.command("impact <change-id>")
    .description("show direct capability and repository impact for one Change as JSON")
    .actionWithContext(async (context, changeId) => {
      const document = await progress.run(
        "Проверка графа перед impact analysis...",
        () => new OpenSpecGraphService(context).readFresh(),
        { success: "OpenSpec Graph актуален" },
      );
      output.log(JSON.stringify(inspectChangeImpact(document, changeId), null, 2));
    }, { scope: "store" });

  graph.command("check-scope <change-id>")
    .description("check proposed Cycle repositories against one Change impact")
    .option("--repo <repository-id>", "proposed Cycle repository-id", {
      parser: collectValues,
      required: true,
    })
    .actionWithContext(async (context, changeId, options) => {
      const document = await progress.run(
        "Проверка графа перед scope check...",
        () => new OpenSpecGraphService(context).readFresh(),
        { success: "OpenSpec Graph актуален" },
      );
      const result = checkChangeScope(document, changeId, options.repo);
      output.log(JSON.stringify(result, null, 2));
      if (result.state === "invalid") {
        throw new Error("OPENSPEC_GRAPH_SCOPE_INVALID: proposed Cycle scope is incomplete");
      }
    }, { scope: "store" });
}
